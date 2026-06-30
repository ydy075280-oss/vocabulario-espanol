/**
 * 大模块路由 /api/modules
 * 用户上传课后作业 → AI 拆解为每日学习任务 → 用户可自由编辑
 * 支持：词汇型（重点单词+例句+造句）和写作型（写作提纲+参考词汇）
 */
import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { query, queryOne, queryAll, transaction, exec } from '../db';
import { generateModulePlan } from '../services/moduleAI';
import { textToSpeech } from '../services/qwenClient';

const router = Router();

/** 构建 task_data JSON */
function buildTaskData(task: any): object {
  return {
    keyWords: task.keyWords || [],
    writingPrompt: task.writingPrompt || '',
    speakingPrompt: task.speakingPrompt || '',
    referenceVocabulary: task.referenceVocabulary || [],
    ttsAudioUrls: {}, // { sentenceIndex: audioUrl }
  };
}

// ============================================================
// POST /api/modules - 创建大模块（AI 分析作业 → 生成计划）
// ============================================================
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  req.setTimeout(120000);
  try {
    const { homeworkText } = req.body;

    if (!homeworkText || !homeworkText.trim()) {
      res.status(400).json({ error: '请上传课后作业内容' });
      return;
    }

    if (homeworkText.length < 20) {
      res.status(400).json({ error: '作业内容太短，请提供更详细的作业要求（至少20字）' });
      return;
    }

    console.log(`[Modules] 用户 ${req.userId} 创建模块，作业长度 ${homeworkText.length}`);
    const aiPlan = await generateModulePlan(homeworkText);

    const moduleId = uuidv4();

    // 保存模块（含内容类型 + 语种）
    await exec(
      `INSERT INTO big_modules (id, user_id, title, description, homework_text, ai_plan_json, content_type, content_type_label, language, status, total_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10)`,
      [
        moduleId,
        req.userId!,
        aiPlan.title,
        aiPlan.description,
        homeworkText,
        JSON.stringify(aiPlan),
        aiPlan.contentType,
        aiPlan.contentTypeLabel,
        aiPlan.language || '',
        aiPlan.dailyTasks.length
      ]
    );

    // 保存每日任务（含 task_data）
    for (const task of aiPlan.dailyTasks) {
      const taskData = buildTaskData(task);
      await exec(
        `INSERT INTO module_tasks (id, module_id, day_number, title, content, task_type, task_data, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          uuidv4(),
          moduleId,
          task.dayNumber,
          task.title,
          task.content,
          task.taskType,
          JSON.stringify(taskData),
          task.dayNumber
        ]
      );
    }

    const mod = await queryOne<any>('SELECT * FROM big_modules WHERE id = $1', [moduleId]);
    const tasks = await queryAll(
      'SELECT * FROM module_tasks WHERE module_id = $1 ORDER BY sort_order',
      [moduleId]
    );

    res.status(201).json({
      message: `AI 识别语种：${aiPlan.language || '未知'}｜已生成 "${aiPlan.title}"（${aiPlan.contentTypeLabel}）的 ${aiPlan.dailyTasks.length} 天学习计划`,
      module: {
        ...mod,
        tasks: (tasks as any[]).map((t: any) => {
          let taskData: any = {};
          try { taskData = JSON.parse(t.task_data || '{}'); } catch { /* ignore */ }
          return { ...t, taskData };
        }),
      },
    });
  } catch (err: any) {
    console.error('[Modules] 创建失败:', err.message);
    res.status(500).json({ error: '创建大模块失败: ' + err.message });
  }
});

// ============================================================
// GET /api/modules - 获取大模块列表
// ============================================================
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const modules = await queryAll<any>(
      `SELECT * FROM big_modules
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [req.userId!]
    );

    const result = await Promise.all(
      modules.map(async (m: any) => {
        const tasks = await queryAll<any>(
          'SELECT completed FROM module_tasks WHERE module_id = $1',
          [m.id]
        );
        const totalTasks = tasks.length;
        const completedTasks = tasks.filter((t: any) => t.completed).length;

        if (totalTasks > 0 && completedTasks === totalTasks && m.status === 'active') {
          await exec(
            "UPDATE big_modules SET status = 'completed', completed_days = $1, updated_at = NOW() WHERE id = $2",
            [m.total_days, m.id]
          );
          m.status = 'completed';
          m.completed_days = m.total_days;
        }

        return {
          ...m,
          totalTasks,
          completedTasks,
          progress: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
        };
      })
    );

    res.json({ modules: result });
  } catch (err: any) {
    res.status(500).json({ error: '获取模块列表失败' });
  }
});

// ============================================================
// GET /api/modules/:id - 获取大模块详情
// ============================================================
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const mod = await queryOne<any>(
      'SELECT * FROM big_modules WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId!]
    );

    if (!mod) {
      res.status(404).json({ error: '大模块不存在' });
      return;
    }

    const tasks = await queryAll(
      'SELECT * FROM module_tasks WHERE module_id = $1 ORDER BY sort_order',
      [req.params.id]
    );

    let aiPlan: any = {};
    try { aiPlan = JSON.parse(mod.ai_plan_json || '{}'); } catch { /* ignore */ }

    res.json({
      module: {
        ...mod,
        tasks: (tasks as any[]).map((t: any) => {
          let taskData: any = {};
          try { taskData = JSON.parse(t.task_data || '{}'); } catch { /* ignore */ }
          return { ...t, taskData };
        }),
        aiPlan,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: '获取模块详情失败' });
  }
});

// ============================================================
// PUT /api/modules/:id - 更新模块信息（标题、描述）
// ============================================================
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const mod = await queryOne<any>(
      'SELECT * FROM big_modules WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId!]
    );

    if (!mod) {
      res.status(404).json({ error: '大模块不存在' });
      return;
    }

    const { title, description } = req.body;

    await exec(
      `UPDATE big_modules
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           updated_at = NOW()
       WHERE id = $3`,
      [title || null, description || null, req.params.id]
    );

    const updated = await queryOne('SELECT * FROM big_modules WHERE id = $1', [req.params.id]);
    res.json({ module: updated, message: '模块信息已更新' });
  } catch (err: any) {
    res.status(500).json({ error: '更新模块失败' });
  }
});

// ============================================================
// PUT /api/modules/:id/tasks/:taskId - 编辑单个任务
// ============================================================
router.put('/:id/tasks/:taskId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const task = await queryOne<any>(
      'SELECT * FROM module_tasks WHERE id = $1 AND module_id = $2',
      [req.params.taskId, req.params.id]
    );

    if (!task) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }

    const { title, content, taskType, writingPrompt, speakingPrompt, referenceVocabulary } = req.body;

    await exec(
      `UPDATE module_tasks
       SET title = COALESCE($1, title),
           content = COALESCE($2, content),
           task_type = COALESCE($3, task_type),
           updated_at = NOW()
       WHERE id = $4`,
      [title || null, content || null, taskType || null, req.params.taskId]
    );

    // 如果提供了 writingPrompt / speakingPrompt 或 referenceVocabulary，更新 task_data
    if (writingPrompt !== undefined || speakingPrompt !== undefined || referenceVocabulary !== undefined) {
      let taskData: any = {};
      try { taskData = JSON.parse(task.task_data || '{}'); } catch { /* ignore */ }
      if (writingPrompt !== undefined) taskData.writingPrompt = writingPrompt;
      if (speakingPrompt !== undefined) taskData.speakingPrompt = speakingPrompt;
      if (referenceVocabulary !== undefined) taskData.referenceVocabulary = referenceVocabulary;
      await exec(
        'UPDATE module_tasks SET task_data = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(taskData), req.params.taskId]
      );
    }

    const updated = await queryOne<any>('SELECT * FROM module_tasks WHERE id = $1', [req.params.taskId]);
    let taskData: any = {};
    try { taskData = JSON.parse(updated.task_data || '{}'); } catch { /* ignore */ }
    res.json({ task: { ...updated, taskData }, message: '任务已更新' });
  } catch (err: any) {
    res.status(500).json({ error: '更新任务失败' });
  }
});

// ============================================================
// POST /api/modules/:id/tasks/:taskId/toggle - 切换任务完成状态
// ============================================================
router.post('/:id/tasks/:taskId/toggle', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const task = await queryOne<any>(
      'SELECT * FROM module_tasks WHERE id = $1 AND module_id = $2',
      [req.params.taskId, req.params.id]
    );

    if (!task) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }

    const newCompleted = task.completed ? 0 : 1;
    const completedAt = newCompleted ? new Date().toISOString() : null;

    await exec(
      `UPDATE module_tasks
       SET completed = $1, completed_at = $2, updated_at = NOW()
       WHERE id = $3`,
      [newCompleted, completedAt, req.params.taskId]
    );

    const tasks = await queryAll<any>(
      'SELECT completed FROM module_tasks WHERE module_id = $1',
      [req.params.id]
    );
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((t: any) => t.completed).length;

    await exec(
      `UPDATE big_modules
       SET completed_days = $1,
           status = CASE WHEN $2 >= total_days THEN 'completed' ELSE status END,
           updated_at = NOW()
       WHERE id = $3`,
      [completedTasks, completedTasks, req.params.id]
    );

    const updated = await queryOne('SELECT * FROM module_tasks WHERE id = $1', [req.params.taskId]);
    res.json({
      task: updated,
      progress: { completedTasks, totalTasks },
    });
  } catch (err: any) {
    res.status(500).json({ error: '切换状态失败' });
  }
});

// ============================================================
// POST /api/modules/:id/tasks/:taskId/tts - 为任务例句生成语音
// ============================================================
router.post('/:id/tasks/:taskId/tts', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const task = await queryOne<any>(
      'SELECT * FROM module_tasks WHERE id = $1 AND module_id = $2',
      [req.params.taskId, req.params.id]
    );

    if (!task) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }

    let taskData: any = {};
    try { taskData = JSON.parse(task.task_data || '{}'); } catch { /* ignore */ }

    const keyWords: any[] = taskData.keyWords || [];
    if (keyWords.length === 0) {
      res.status(400).json({ error: '该任务没有例句可生成语音' });
      return;
    }

    // 收集所有需要生成语音的句子
    const sentences: { keyword: string; sentenceEs: string }[] = [];
    for (const kw of keyWords) {
      if (kw.exampleSentence) {
        sentences.push({ keyword: kw.word, sentenceEs: kw.exampleSentence });
      }
    }

    if (sentences.length === 0) {
      res.status(400).json({ error: '没有找到例句文本' });
      return;
    }

    const outputDir = path.join(__dirname, '..', '..', 'uploads', 'tts');
    const ttsAudioUrls: Record<string, string> = taskData.ttsAudioUrls || {};
    const results: { keyword: string; audioUrl: string }[] = [];

    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      const fileName = `module_tts_${req.params.taskId}_${i}.mp3`;
      const outputPath = path.join(outputDir, fileName);

      try {
        await textToSpeech(
          { text: s.sentenceEs, voice: 'Cherry', speed: 0.85 },
          outputPath
        );
        const audioUrl = `/uploads/tts/${fileName}`;
        ttsAudioUrls[s.keyword] = audioUrl;
        results.push({ keyword: s.keyword, audioUrl });
      } catch (ttsErr: any) {
        console.error(`[TTS] 生成失败 (${s.keyword}):`, ttsErr.message);
        results.push({ keyword: s.keyword, audioUrl: '' });
      }
    }

    // 保存 TTS URL 回 task_data
    taskData.ttsAudioUrls = ttsAudioUrls;
    await exec(
      'UPDATE module_tasks SET task_data = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(taskData), req.params.taskId]
    );

    res.json({ results, message: `成功生成 ${results.filter(r => r.audioUrl).length}/${results.length} 段语音` });
  } catch (err: any) {
    res.status(500).json({ error: 'TTS 生成失败: ' + err.message });
  }
});

// ============================================================
// POST /api/modules/:id/tasks/:taskId/tts-user - 用户造句文本 TTS
// ============================================================
router.post('/:id/tasks/:taskId/tts-user', authMiddleware, async (req: AuthRequest, res: Response) => {
  req.setTimeout(60000);
  try {
    const { text, keywordIndex } = req.body;
    console.log(`[TTS-User] 收到请求: taskId=${req.params.taskId}, text="${text?.slice(0, 50)}...", len=${text?.length}`);

    if (!text || !text.trim()) {
      res.status(400).json({ error: '请提供需要朗读的文本' });
      return;
    }

    const outputDir = path.join(__dirname, '..', '..', 'uploads', 'tts');
    const fileName = `user_tts_${req.params.taskId}_${keywordIndex ?? 'x'}_${Date.now()}.mp3`;
    const outputPath = path.join(outputDir, fileName);

    console.log(`[TTS-User] 调用 textToSpeech → ${outputPath}`);
    const t0 = Date.now();

    await textToSpeech(
      { text: text.trim(), voice: 'Cherry', speed: 0.85 },
      outputPath
    );

    console.log(`[TTS-User] ✅ 生成成功，耗时 ${Date.now() - t0}ms, 文件: ${fileName}`);
    const audioUrl = `/uploads/tts/${fileName}`;
    res.json({ audioUrl });
  } catch (err: any) {
    console.error('[TTS-User] ❌ 生成失败:', err.message);
    console.error('[TTS-User] 完整错误:', err.stack || err);
    res.status(500).json({ error: '语音生成失败: ' + err.message });
  }
});

// ============================================================
// POST /api/modules/:id/tasks/:taskId/sentences - 保存用户造句
// ============================================================
router.post('/:id/tasks/:taskId/sentences', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { userSentences } = req.body;

    const task = await queryOne<any>(
      'SELECT * FROM module_tasks WHERE id = $1 AND module_id = $2',
      [req.params.taskId, req.params.id]
    );

    if (!task) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }

    let taskData: any = {};
    try { taskData = JSON.parse(task.task_data || '{}'); } catch { /* ignore */ }

    taskData.userSentences = { ...(taskData.userSentences || {}), ...userSentences };

    await exec(
      'UPDATE module_tasks SET task_data = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(taskData), req.params.taskId]
    );

    res.json({ message: '造句已保存', userSentences: taskData.userSentences });
  } catch (err: any) {
    res.status(500).json({ error: '保存造句失败: ' + err.message });
  }
});

// ============================================================
// POST /api/modules/:id/tasks/:taskId/writing - 保存用户写作
// ============================================================
router.post('/:id/tasks/:taskId/writing', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { content, title } = req.body;

    const task = await queryOne<any>(
      'SELECT * FROM module_tasks WHERE id = $1 AND module_id = $2',
      [req.params.taskId, req.params.id]
    );

    if (!task) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }

    let taskData: any = {};
    try { taskData = JSON.parse(task.task_data || '{}'); } catch { /* ignore */ }

    if (content !== undefined) taskData.userWriting = content;
    if (title !== undefined) taskData.userWritingTitle = title;

    await exec(
      'UPDATE module_tasks SET task_data = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(taskData), req.params.taskId]
    );

    res.json({ message: '写作已保存', userWriting: taskData.userWriting });
  } catch (err: any) {
    res.status(500).json({ error: '保存写作失败: ' + err.message });
  }
});

// ============================================================
// POST /api/modules/:id/tasks/:taskId/speaking - 保存用户口语对话
// ============================================================
router.post('/:id/tasks/:taskId/speaking', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { content } = req.body;

    const task = await queryOne<any>(
      'SELECT * FROM module_tasks WHERE id = $1 AND module_id = $2',
      [req.params.taskId, req.params.id]
    );

    if (!task) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }

    let taskData: any = {};
    try { taskData = JSON.parse(task.task_data || '{}'); } catch { /* ignore */ }

    if (content !== undefined) taskData.userSpeaking = content;

    await exec(
      'UPDATE module_tasks SET task_data = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(taskData), req.params.taskId]
    );

    res.json({ message: '口语对话已保存', userSpeaking: taskData.userSpeaking });
  } catch (err: any) {
    res.status(500).json({ error: '保存口语对话失败: ' + err.message });
  }
});

// ============================================================
// PUT /api/modules/:id/tasks/:taskId/keywords - 更新任务关键词（增删改）
// ============================================================
router.put('/:id/tasks/:taskId/keywords', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const task = await queryOne<any>(
      'SELECT * FROM module_tasks WHERE id = $1 AND module_id = $2',
      [req.params.taskId, req.params.id]
    );

    if (!task) { res.status(404).json({ error: '任务不存在' }); return; }

    const { keyWords } = req.body;
    if (!Array.isArray(keyWords)) {
      res.status(400).json({ error: 'keyWords 必须是数组' });
      return;
    }

    let taskData: any = {};
    try { taskData = JSON.parse(task.task_data || '{}'); } catch { /* ignore */ }
    taskData.keyWords = keyWords;

    await exec(
      "UPDATE module_tasks SET task_data = $1, updated_at = NOW() WHERE id = $2",
      [JSON.stringify(taskData), req.params.taskId]
    );

    const updated = await queryOne<any>('SELECT * FROM module_tasks WHERE id = $1', [req.params.taskId]);
    res.json({ task: { ...updated, taskData }, message: '关键词已更新' });
  } catch (err: any) {
    res.status(500).json({ error: '更新关键词失败: ' + err.message });
  }
});

// ============================================================
// POST /api/modules/:id/tasks - 手动添加新的一天任务
// ============================================================
router.post('/:id/tasks', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const mod = await queryOne<any>(
      'SELECT * FROM big_modules WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId!]
    );

    if (!mod) { res.status(404).json({ error: '大模块不存在' }); return; }

    const { title, content, taskType, dayNumber, keyWords, writingPrompt, speakingPrompt, referenceVocabulary } = req.body;
    const day = dayNumber || (mod.total_days + 1);

    const taskId = uuidv4();
    const taskData = {
      keyWords: keyWords || [],
      writingPrompt: writingPrompt || '',
      speakingPrompt: speakingPrompt || '',
      referenceVocabulary: referenceVocabulary || [],
      ttsAudioUrls: {},
    };

    await exec(
      `INSERT INTO module_tasks (id, module_id, day_number, title, content, task_type, task_data, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        taskId, req.params.id, day,
        title || `第 ${day} 天`,
        content || '',
        taskType || 'vocabulary',
        JSON.stringify(taskData),
        day
      ]
    );

    // 更新模块总天数
    const newTotalDays = Math.max(mod.total_days, day);
    await exec(
      "UPDATE big_modules SET total_days = $1, updated_at = NOW() WHERE id = $2",
      [newTotalDays, req.params.id]
    );

    const task = await queryOne<any>('SELECT * FROM module_tasks WHERE id = $1', [taskId]);
    res.status(201).json({ task: { ...task, taskData }, message: `已添加第 ${day} 天任务` });
  } catch (err: any) {
    res.status(500).json({ error: '添加任务失败: ' + err.message });
  }
});

// ============================================================
// DELETE /api/modules/:id/tasks/:taskId - 删除某一天任务
// ============================================================
router.delete('/:id/tasks/:taskId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const task = await queryOne<any>(
      'SELECT * FROM module_tasks WHERE id = $1 AND module_id = $2',
      [req.params.taskId, req.params.id]
    );

    if (!task) { res.status(404).json({ error: '任务不存在' }); return; }

    await exec('DELETE FROM module_tasks WHERE id = $1', [req.params.taskId]);

    // 重新计算模块总天数
    const remaining = await queryOne<any>(
      'SELECT COUNT(*) as cnt FROM module_tasks WHERE module_id = $1',
      [req.params.id]
    );

    await exec(
      "UPDATE big_modules SET total_days = $1, updated_at = NOW() WHERE id = $2",
      [remaining.cnt, req.params.id]
    );

    res.json({ message: '任务已删除', remainingDays: parseInt(remaining.cnt) });
  } catch (err: any) {
    res.status(500).json({ error: '删除任务失败: ' + err.message });
  }
});

// ============================================================
// POST /api/modules/:id/export-wordbook - 导出模块词汇为单词本
// ============================================================
router.post('/:id/export-wordbook', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const mod = await queryOne<any>(
      'SELECT * FROM big_modules WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId!]
    );

    if (!mod) {
      res.status(404).json({ error: '大模块不存在' });
      return;
    }

    // 检查是否已导出过
    if (mod.linked_wordbook_id) {
      const existing = await queryOne<any>(
        'SELECT id, name, card_count FROM wordbooks WHERE id = $1 AND user_id = $2',
        [mod.linked_wordbook_id, req.userId!]
      );

      if (existing) {
        res.status(200).json({
          message: `该模块已导出过单词本「${existing.name}」（${existing.card_count} 个词汇）`,
          wordbook: {
            id: existing.id,
            name: existing.name,
            cardCount: existing.card_count,
          },
          alreadyExported: true,
        });
        return;
      }
      // 单词本已被删除，清除关联后重新导出
      await exec('UPDATE big_modules SET linked_wordbook_id = NULL WHERE id = $1', [req.params.id]);
    }

    // 获取所有任务的 keyWords
    const tasks = await queryAll<any>(
      'SELECT task_data FROM module_tasks WHERE module_id = $1',
      [req.params.id]
    );

    // 收集所有关键词
    const allKeywords: Array<{
      word: string; translation: string; partOfSpeech: string;
      exampleSentence: string; exampleTranslation: string;
    }> = [];

    for (const t of tasks) {
      let td: any = {};
      try { td = JSON.parse(t.task_data || '{}'); } catch { /* ignore */ }
      if (td.keyWords) {
        for (const kw of td.keyWords) {
          if (kw.word?.trim()) {
            allKeywords.push({
              word: kw.word.trim(),
              translation: kw.translation || '',
              partOfSpeech: kw.partOfSpeech || '',
              exampleSentence: kw.exampleSentence || '',
              exampleTranslation: kw.exampleTranslation || '',
            });
          }
        }
      }
    }

    if (allKeywords.length === 0) {
      res.status(400).json({ error: '该模块没有可导出的词汇，请先添加单词' });
      return;
    }

    // 按 word_normalized 去重
    const normalize = (w: string) =>
      w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    const uniqueMap = new Map<string, typeof allKeywords[0]>();
    for (const kw of allKeywords) {
      const key = normalize(kw.word);
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, kw);
      }
    }

    const uniqueKeywords = Array.from(uniqueMap.values());

    // 创建单词本
    const wordbookId = uuidv4();
    const wordbookName = `${mod.title} - 词汇本`;

    await exec(
      `INSERT INTO wordbooks (id, user_id, name, source_type, source_name, card_count)
       VALUES ($1, $2, $3, 'module', $4, 0)`,
      [wordbookId, req.userId!, wordbookName, mod.title]
    );

    // 批量创建单词卡片
    await transaction(async (client) => {
      for (const kw of uniqueKeywords) {
        const cardId = uuidv4();
        const normalized = normalize(kw.word);

        await client.query(
          `INSERT INTO word_cards (
            id, wordbook_id, user_id, word, word_normalized, part_of_speech,
            gender, definite_article, chinese_meaning, original_form, conjugation_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            cardId, wordbookId, req.userId!, kw.word, normalized,
            kw.partOfSpeech, '', '', kw.translation, kw.word, '{}'
          ]
        );

        if (kw.exampleSentence) {
          await client.query(
            'INSERT INTO example_sentences (id, card_id, sentence_es, sentence_zh) VALUES ($1, $2, $3, $4)',
            [uuidv4(), cardId, kw.exampleSentence, kw.exampleTranslation]
          );
        }
      }
    });

    // 更新单词本卡片计数
    await exec(
      'UPDATE wordbooks SET card_count = (SELECT COUNT(*) FROM word_cards WHERE wordbook_id = $1), updated_at = NOW() WHERE id = $1',
      [wordbookId]
    );

    // 关联到模块
    await exec(
      'UPDATE big_modules SET linked_wordbook_id = $1, updated_at = NOW() WHERE id = $2',
      [wordbookId, req.params.id]
    );

    res.status(201).json({
      message: `已创建单词本 "${wordbookName}"，收录 ${uniqueKeywords.length} 个词汇（原始 ${allKeywords.length} 个，去重后保留）`,
      wordbook: {
        id: wordbookId,
        name: wordbookName,
        cardCount: uniqueKeywords.length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: '导出单词本失败: ' + err.message });
  }
});

// ============================================================
// PUT /api/modules/:id/reorder - 拖拽调整任务/天数顺序
// ============================================================
router.put('/:id/reorder', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const mod = await queryOne<any>(
      'SELECT * FROM big_modules WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId!]
    );

    if (!mod) { res.status(404).json({ error: '大模块不存在' }); return; }

    const { tasks } = req.body; // [{ id: string, day_number: number, sort_order: number }]
    if (!Array.isArray(tasks)) {
      res.status(400).json({ error: 'tasks 必须是数组' });
      return;
    }

    await transaction(async (client) => {
      for (const t of tasks) {
        await client.query(
          `UPDATE module_tasks SET day_number = $1, sort_order = $2, updated_at = NOW() WHERE id = $3 AND module_id = $4`,
          [t.day_number, t.sort_order, t.id, req.params.id]
        );
      }
    });

    res.json({ message: '排序已更新' });
  } catch (err: any) {
    res.status(500).json({ error: '排序失败: ' + err.message });
  }
});

// ============================================================
// DELETE /api/modules/:id - 删除大模块
// ============================================================
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const mod = await queryOne<any>(
      'SELECT * FROM big_modules WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId!]
    );

    if (!mod) {
      res.status(404).json({ error: '大模块不存在' });
      return;
    }

    await exec('DELETE FROM big_modules WHERE id = $1', [req.params.id]);
    res.json({ message: '大模块已删除' });
  } catch (err: any) {
    res.status(500).json({ error: '删除失败' });
  }
});

export default router;
