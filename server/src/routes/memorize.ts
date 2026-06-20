/**
 * 背诵模块路由 /api/memorize
 * 用户可将模块中的写作卡片加入背诵列表
 * 数据存储：在 module_tasks.task_data JSON 中加 memorize 标记
 */
import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { query, queryOne, queryAll, exec } from '../db';

const router = Router();

// ============================================================
// GET /api/memorize - 获取当前用户所有背诵项
// ============================================================
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    // 查用户所有模块下的任务，在后端内存中 JSON.parse 过滤
    // 避免 SQLite/PG JSON 函数差异
    const rows = await queryAll<any>(
      `SELECT mt.*, bm.title as module_title, bm.id as module_id_dup
       FROM module_tasks mt
       JOIN big_modules bm ON mt.module_id = bm.id
       WHERE bm.user_id = $1 AND mt.task_data IS NOT NULL AND mt.task_data != '{}'
       ORDER BY mt.updated_at DESC`,
      [req.userId!]
    );

    const items = rows
      .map((row: any) => {
        let td: any = {};
        try { td = JSON.parse(row.task_data || '{}'); } catch { /* ignore */ }
        return { ...row, taskData: td };
      })
      .filter((row: any) => row.taskData.memorize === true);

    res.json({ items, count: items.length });
  } catch (err: any) {
    console.error('[Memorize] 列表查询失败:', err.message);
    res.status(500).json({ error: '获取背诵列表失败' });
  }
});

// ============================================================
// POST /api/memorize/toggle - 切换某个写作任务的背诵状态
// ============================================================
router.post('/toggle', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { moduleId, taskId } = req.body;

    if (!moduleId || !taskId) {
      res.status(400).json({ error: '缺少 moduleId 或 taskId' });
      return;
    }

    // 验证任务存在且属于该用户
    const task = await queryOne<any>(
      `SELECT mt.*, bm.user_id
       FROM module_tasks mt
       JOIN big_modules bm ON mt.module_id = bm.id
       WHERE mt.id = $1 AND mt.module_id = $2 AND bm.user_id = $3`,
      [taskId, moduleId, req.userId!]
    );

    if (!task) {
      res.status(404).json({ error: '任务不存在或无权操作' });
      return;
    }

    let taskData: any = {};
    try { taskData = JSON.parse(task.task_data || '{}'); } catch { /* ignore */ }

    const currentlyMemorized = !!taskData.memorize;
    taskData.memorize = !currentlyMemorized;

    await exec(
      'UPDATE module_tasks SET task_data = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(taskData), taskId]
    );

    res.json({
      memorize: taskData.memorize,
      message: taskData.memorize ? '已加入背诵列表' : '已从背诵列表移除',
    });
  } catch (err: any) {
    console.error('[Memorize] 切换失败:', err.message);
    res.status(500).json({ error: '操作失败: ' + err.message });
  }
});

export default router;
