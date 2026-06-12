/**
 * 大模块路由 /api/modules
 * 用户上传课后作业 → AI 拆解为每日学习任务 → 用户可自由编辑
 * 支持：词汇型（重点单词+例句+造句）和写作型（写作提纲+参考词汇）
 */
import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import db from '../db';
import { generateModulePlan } from '../services/moduleAI';
import { textToSpeech } from '../services/qwenClient';

const router = Router();

/** 构建 task_data JSON */
function buildTaskData(task: any): object {
  return {
    keyWords: task.keyWords || [],
    writingPrompt: task.writingPrompt || '',
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
    db.prepare(`
      INSERT INTO big_modules (id, user_id, title, description, homework_text, ai_plan_json, content_type, content_type_label, language, status, total_days)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(
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
    );

    // 保存每日任务（含 task_data）
    const insertTask = db.prepare(`
      INSERT INTO module_tasks (id, module_id, day_number, title, content, task_type, task_data, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const task of aiPlan.dailyTasks) {
      const taskData = buildTaskData(task);
      insertTask.run(
        uuidv4(),
        moduleId,
        task.dayNumber,
        task.title,
        task.content,
        task.taskType,
        JSON.stringify(taskData),
        task.dayNumber
      );
    }

    const module = db.prepare('SELECT * FROM big_modules WHERE id = ?').get(moduleId) as any;
    const tasks = db.prepare(
      'SELECT * FROM module_tasks WHERE module_id = ? ORDER BY sort_order'
    ).all(moduleId);

    res.status(201).json({
      message: `AI 识别语种：${aiPlan.language || '未知'}｜已生成 "${aiPlan.title}"（${aiPlan.contentTypeLabel}）的 ${aiPlan.dailyTasks.length} 天学习计划`,
      module: {
        ...module,
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
router.get('/', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const modules = db.prepare(`
      SELECT * FROM big_modules
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `).all(req.userId!);

    const result = (modules as any[]).map((m: any) => {
      const tasks = db.prepare(
        'SELECT completed FROM module_tasks WHERE module_id = ?'
      ).all(m.id) as any[];
      const totalTasks = tasks.length;
      const completedTasks = tasks.filter((t: any) => t.completed).length;

      if (totalTasks > 0 && completedTasks === totalTasks && m.status === 'active') {
        db.prepare(
          "UPDATE big_modules SET status = 'completed', completed_days = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(m.total_days, m.id);
        m.status = 'completed';
        m.completed_days = m.total_days;
      }

      return {
        ...m,
        totalTasks,
        completedTasks,
        progress: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      };
    });

    res.json({ modules: result });
  } catch (err: any) {
    res.status(500).json({ error: '获取模块列表失败' });
  }
});

// ============================================================
// GET /api/modules/:id - 获取大模块详情
// ============================================================
router.get('/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const module = db.prepare(
      'SELECT * FROM big_modules WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.userId!) as any;

    if (!module) {
      res.status(404).json({ error: '大模块不存在' });
      return;
    }

    const tasks = db.prepare(
      'SELECT * FROM module_tasks WHERE module_id = ? ORDER BY sort_order'
    ).all(req.params.id);

    let aiPlan: any = {};
    try { aiPlan = JSON.parse(module.ai_plan_json || '{}'); } catch { /* ignore */ }

    res.json({
      module: {
        ...module,
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
router.put('/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const module = db.prepare(
      'SELECT * FROM big_modules WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.userId!) as any;

    if (!module) {
      res.status(404).json({ error: '大模块不存在' });
      return;
    }

    const { title, description } = req.body;

    db.prepare(`
      UPDATE big_modules
      SET title = COALESCE(?, title),
          description = COALESCE(?, description),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(title || null, description || null, req.params.id);

    const updated = db.prepare('SELECT * FROM big_modules WHERE id = ?').get(req.params.id);
    res.json({ module: updated, message: '模块信息已更新' });
  } catch (err: any) {
    res.status(500).json({ error: '更新模块失败' });
  }
});

// ============================================================
// PUT /api/modules/:id/tasks/:taskId - 编辑单个任务
// ============================================================
router.put('/:id/tasks/:taskId', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const task = db.prepare(
      'SELECT * FROM module_tasks WHERE id = ? AND module_id = ?'
    ).get(req.params.taskId, req.params.id) as any;

    if (!task) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }

    const { title, content, taskType } = req.body;

    db.prepare(`
      UPDATE module_tasks
      SET title = COALESCE(?, title),
          content = COALESCE(?, content),
          task_type = COALESCE(?, task_type),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(title || null, content || null, taskType || null, req.params.taskId);

    const updated = db.prepare('SELECT * FROM module_tasks WHERE id = ?').get(req.params.taskId) as any;
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
router.post('/:id/tasks/:taskId/toggle', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const task = db.prepare(
      'SELECT * FROM module_tasks WHERE id = ? AND module_id = ?'
    ).get(req.params.taskId, req.params.id) as any;

    if (!task) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }

    const newCompleted = task.completed ? 0 : 1;
    const completedAt = newCompleted ? new Date().toISOString() : null;

    db.prepare(`
      UPDATE module_tasks
      SET completed = ?, completed_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(newCompleted, completedAt, req.params.taskId);

    const tasks = db.prepare(
      'SELECT completed FROM module_tasks WHERE module_id = ?'
    ).all(req.params.id) as any[];
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((t: any) => t.completed).length;

    db.prepare(`
      UPDATE big_modules
      SET completed_days = ?,
          status = CASE WHEN ? >= total_days THEN 'completed' ELSE status END,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(completedTasks, completedTasks, req.params.id);

    const updated = db.prepare('SELECT * FROM module_tasks WHERE id = ?').get(req.params.taskId);
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
    const task = db.prepare(
      'SELECT * FROM module_tasks WHERE id = ? AND module_id = ?'
    ).get(req.params.taskId, req.params.id) as any;

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
    db.prepare(`
      UPDATE module_tasks SET task_data = ?, updated_at = datetime('now') WHERE id = ?
    `).run(JSON.stringify(taskData), req.params.taskId);

    res.json({ results, message: `成功生成 ${results.filter(r => r.audioUrl).length}/${results.length} 段语音` });
  } catch (err: any) {
    res.status(500).json({ error: 'TTS 生成失败: ' + err.message });
  }
});

// ============================================================
// POST /api/modules/:id/tasks/:taskId/tts-user - 用户造句文本 TTS
// ============================================================
router.post('/:id/tasks/:taskId/tts-user', authMiddleware, async (req: AuthRequest, res: Response) => {
  req.setTimeout(60000); // TTS 最长 60s
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
    const { userSentences } = req.body; // { "keywordWord": ["sentence1", "sentence2"], ... }

    const task = db.prepare(
      'SELECT * FROM module_tasks WHERE id = ? AND module_id = ?'
    ).get(req.params.taskId, req.params.id) as any;

    if (!task) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }

    let taskData: any = {};
    try { taskData = JSON.parse(task.task_data || '{}'); } catch { /* ignore */ }

    taskData.userSentences = { ...(taskData.userSentences || {}), ...userSentences };

    db.prepare(`
      UPDATE module_tasks SET task_data = ?, updated_at = datetime('now') WHERE id = ?
    `).run(JSON.stringify(taskData), req.params.taskId);

    res.json({ message: '造句已保存', userSentences: taskData.userSentences });
  } catch (err: any) {
    res.status(500).json({ error: '保存造句失败: ' + err.message });
  }
});

// ============================================================
// PUT /api/modules/:id/tasks/:taskId/keywords - 更新任务关键词（增删改）
// ============================================================
router.put('/:id/tasks/:taskId/keywords', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const task = db.prepare(
      'SELECT * FROM module_tasks WHERE id = ? AND module_id = ?'
    ).get(req.params.taskId, req.params.id) as any;

    if (!task) { res.status(404).json({ error: '任务不存在' }); return; }

    const { keyWords } = req.body; // 完整的关键词数组
    if (!Array.isArray(keyWords)) {
      res.status(400).json({ error: 'keyWords 必须是数组' });
      return;
    }

    let taskData: any = {};
    try { taskData = JSON.parse(task.task_data || '{}'); } catch { /* ignore */ }
    taskData.keyWords = keyWords;

    db.prepare(
      'UPDATE module_tasks SET task_data = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(JSON.stringify(taskData), req.params.taskId);

    const updated = db.prepare('SELECT * FROM module_tasks WHERE id = ?').get(req.params.taskId) as any;
    res.json({ task: { ...updated, taskData }, message: '关键词已更新' });
  } catch (err: any) {
    res.status(500).json({ error: '更新关键词失败: ' + err.message });
  }
});

// ============================================================
// POST /api/modules/:id/tasks - 手动添加新的一天任务
// ============================================================
router.post('/:id/tasks', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const module = db.prepare(
      'SELECT * FROM big_modules WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.userId!) as any;

    if (!module) { res.status(404).json({ error: '大模块不存在' }); return; }

    const { title, content, taskType, dayNumber, keyWords, writingPrompt, referenceVocabulary } = req.body;
    const day = dayNumber || (module.total_days + 1);

    const taskId = uuidv4();
    const taskData = {
      keyWords: keyWords || [],
      writingPrompt: writingPrompt || '',
      referenceVocabulary: referenceVocabulary || [],
      ttsAudioUrls: {},
    };

    db.prepare(`
      INSERT INTO module_tasks (id, module_id, day_number, title, content, task_type, task_data, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      taskId, req.params.id, day,
      title || `第 ${day} 天`,
      content || '',
      taskType || 'vocabulary',
      JSON.stringify(taskData),
      day
    );

    // 更新模块总天数
    const newTotalDays = Math.max(module.total_days, day);
    db.prepare(
      "UPDATE big_modules SET total_days = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(newTotalDays, req.params.id);

    const task = db.prepare('SELECT * FROM module_tasks WHERE id = ?').get(taskId) as any;
    res.status(201).json({ task: { ...task, taskData }, message: `已添加第 ${day} 天任务` });
  } catch (err: any) {
    res.status(500).json({ error: '添加任务失败: ' + err.message });
  }
});

// ============================================================
// DELETE /api/modules/:id/tasks/:taskId - 删除某一天任务
// ============================================================
router.delete('/:id/tasks/:taskId', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const task = db.prepare(
      'SELECT * FROM module_tasks WHERE id = ? AND module_id = ?'
    ).get(req.params.taskId, req.params.id) as any;

    if (!task) { res.status(404).json({ error: '任务不存在' }); return; }

    db.prepare('DELETE FROM module_tasks WHERE id = ?').run(req.params.taskId);

    // 重新计算模块总天数
    const remaining = db.prepare(
      'SELECT COUNT(*) as cnt FROM module_tasks WHERE module_id = ?'
    ).get(req.params.id) as any;

    db.prepare(
      "UPDATE big_modules SET total_days = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(remaining.cnt, req.params.id);

    res.json({ message: '任务已删除', remainingDays: remaining.cnt });
  } catch (err: any) {
    res.status(500).json({ error: '删除任务失败: ' + err.message });
  }
});

// ============================================================
// DELETE /api/modules/:id - 删除大模块
// ============================================================
router.delete('/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const module = db.prepare(
      'SELECT * FROM big_modules WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.userId!) as any;

    if (!module) {
      res.status(404).json({ error: '大模块不存在' });
      return;
    }

    db.prepare('DELETE FROM big_modules WHERE id = ?').run(req.params.id);
    res.json({ message: '大模块已删除' });
  } catch (err: any) {
    res.status(500).json({ error: '删除失败' });
  }
});

export default router;
