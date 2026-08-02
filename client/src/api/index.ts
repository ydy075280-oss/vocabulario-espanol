import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor - add auth token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor - handle token refresh
let isRefreshing = false;
let failedQueue: Array<{ resolve: (v: any) => void; reject: (e: any) => void }> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) prom.reject(error);
    else prom.resolve(token);
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // 排除登录/注册/刷新接口自身的 401（如密码错误），不触发 token 刷新
    const isAuthEndpoint = originalRequest.url?.includes('/auth/login')
      || originalRequest.url?.includes('/auth/register')
      || originalRequest.url?.includes('/auth/refresh');

    if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/auth';
        return Promise.reject(error);
      }

      try {
        const { data } = await axios.post(`${API_BASE}/auth/refresh`, { refreshToken });
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        processQueue(null, data.accessToken);
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/auth';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

// ------ Auth API ------
export const authAPI = {
  register: (data: { email: string; password: string; nickname?: string }) =>
    api.post('/auth/register', data),
  login: (data: { email: string; password: string; rememberMe?: boolean }) =>
    api.post('/auth/login', data),
  logout: () => {
    const refreshToken = localStorage.getItem('refreshToken');
    return api.post('/auth/logout', { refreshToken });
  },
  me: () => api.get('/auth/me'),
  updateProfile: (data: { nickname?: string; avatar_url?: string; tts_speed?: number }) =>
    api.put('/auth/profile', data),
};

// ------ Upload API ------
export const uploadAPI = {
  upload: (formData: FormData, onProgress?: (pct: number) => void) =>
    api.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded * 100) / e.total));
      },
    }),
  extract: (data: { filePath: string; fileType: string; wordbookId: string }) =>
    api.post('/upload/extract', data, { timeout: 180000 }),
};

// ------ Wordbooks API ------
export const wordbookAPI = {
  list: () => api.get('/wordbooks'),
  create: (data: { name: string; teacherTag?: string; courseTag?: string; sourceType?: string }) =>
    api.post('/wordbooks', data),
  get: (id: string) => api.get(`/wordbooks/${id}`),
  update: (id: string, data: { name?: string; teacherTag?: string; courseTag?: string }) =>
    api.put(`/wordbooks/${id}`, data),
  delete: (id: string) => api.delete(`/wordbooks/${id}`),
  tags: () => api.get('/wordbooks/tags') as Promise<{ data: { teacherTags: string[]; courseTags: string[]; allTags: string[] } }>,
};

// ------ Cards API ------
export const cardAPI = {
  list: (params?: { wordbookId?: string; status?: string; search?: string }) =>
    api.get('/cards', { params }),
  create: (data: any) => api.post('/cards', data),
  batchCreate: (data: { wordbookId: string; words: any[] }) =>
    api.post('/cards/batch', data),
  get: (id: string) => api.get(`/cards/${id}`),
  update: (id: string, data: any) => api.put(`/cards/${id}`, data),
  delete: (id: string) => api.delete(`/cards/${id}`),
};

// ------ Learn API ------
export const learnAPI = {
  getToday: () => api.get('/learn/today'),
  getWordbookCards: (wordbookId: string, mode?: string) =>
    api.get(`/learn/wordbook/${wordbookId}`, { params: { mode } }),
  score: (data: { cardId: string; score: number; mode?: string; timeSpent?: number }) =>
    api.post('/learn/score', data),
  stats: () => api.get('/learn/stats'),
};

// ------ Create API ------
export const createAPI = {
  list: () => api.get('/create'),
  analyze: (requirement: string) => api.post('/create/analyze', { requirement }),
  save: (data: {
    teacherRequirement?: string;
    keywords?: any[];
    userTextEs: string;
    userTextZh?: string;
    wordbookName?: string;
    teacherTag?: string;
    courseTag?: string;
  }) => api.post('/create', data),
  get: (id: string) => api.get(`/create/${id}`),
  delete: (id: string) => api.delete(`/create/${id}`),
};

// ------ Modules API ------
export const moduleAPI = {
  list: () => api.get('/modules'),
  // AI 生成学习计划较慢，单独设置 300s 超时
  create: (homeworkText: string) =>
    api.post('/modules', { homeworkText }, { timeout: 300000 }),
  get: (id: string) => api.get(`/modules/${id}`),
  update: (id: string, data: { title?: string; description?: string }) =>
    api.put(`/modules/${id}`, data),
  updateTask: (moduleId: string, taskId: string, data: { title?: string; content?: string; taskType?: string; writingPrompt?: string; speakingPrompt?: string; speakingCards?: any[]; referenceVocabulary?: string[] }) =>
    api.put(`/modules/${moduleId}/tasks/${taskId}`, data),
  toggleTask: (moduleId: string, taskId: string) =>
    api.post(`/modules/${moduleId}/tasks/${taskId}/toggle`),
  // TTS: 为任务例句生成语音
  generateTTS: (moduleId: string, taskId: string) =>
    api.post(`/modules/${moduleId}/tasks/${taskId}/tts`, {}, { timeout: 120000 }),
  // TTS: 为用户输入的造句文本生成语音
  generateUserTTS: (moduleId: string, taskId: string, text: string, keywordIndex: number) =>
    api.post(`/modules/${moduleId}/tasks/${taskId}/tts-user`, { text, keywordIndex }, { timeout: 60000 }),
  // 保存用户造句
  saveSentences: (moduleId: string, taskId: string, userSentences: Record<string, string[]>) =>
    api.post(`/modules/${moduleId}/tasks/${taskId}/sentences`, { userSentences }),
  // 更新任务关键词（增删改）
  updateKeywords: (moduleId: string, taskId: string, keyWords: any[]) =>
    api.put(`/modules/${moduleId}/tasks/${taskId}/keywords`, { keyWords }),
  // 手动添加新的一天任务
  addTask: (moduleId: string, data: {
    title?: string; content?: string; taskType?: string;
    dayNumber?: number; keyWords?: any[]; writingPrompt?: string; referenceVocabulary?: string[];
  }) => api.post(`/modules/${moduleId}/tasks`, data),
  // 保存用户写作
  saveWriting: (moduleId: string, taskId: string, content: string, title?: string) =>
    api.post(`/modules/${moduleId}/tasks/${taskId}/writing`, { content, title }),
  // 保存用户口语对话(支持多卡片)
  saveSpeaking: (moduleId: string, taskId: string, content: string, cardIndex?: number) =>
    api.post(`/modules/${moduleId}/tasks/${taskId}/speaking`, { content, cardIndex }),
  // 删除某一天任务
  deleteTask: (moduleId: string, taskId: string) =>
    api.delete(`/modules/${moduleId}/tasks/${taskId}`),
  delete: (id: string) => api.delete(`/modules/${id}`),
  // 导出模块词汇为单词本
  exportWordbook: (id: string) => api.post(`/modules/${id}/export-wordbook`),
  // 拖拽排序更新
  reorder: (moduleId: string, tasks: { id: string; day_number: number; sort_order: number }[]) =>
    api.put(`/modules/${moduleId}/reorder`, { tasks }),
};

// ------ Memorize API ------
export const memorizeAPI = {
  list: () => api.get('/memorize'),
  toggle: (moduleId: string, taskId: string) =>
    api.post('/memorize/toggle', { moduleId, taskId }),
};

// ------ Chat API (SSE streaming, uses native fetch) ------
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatWord {
  word: string;
  translation: string;
}

export interface ChatGreeting {
  text: string;
  audioUrl: string;
}

export interface SSEChatEvent {
  event: string;
  data: any;
}

/**
 * 获取开场白 + 语音
 */
export async function getChatGreeting(params: {
  scenario: string;
  scenarioLabel: string;
  difficulty: string;
  wordbookWords?: ChatWord[];
}): Promise<ChatGreeting> {
  const token = localStorage.getItem('accessToken');
  const res = await fetch(`${API_BASE_URL}/chat/greet`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      scenario: params.scenario,
      scenarioLabel: params.scenarioLabel,
      difficulty: params.difficulty,
      wordbookWords: params.wordbookWords ? JSON.stringify(params.wordbookWords) : undefined,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '开场白请求失败' }));
    throw new Error(err.error || '开场白请求失败');
  }
  return res.json();
}

/**
 * 发送用户语音，SSE 流式接收 AI 回复
 * 返回 ReadableStream，需要手动解析 SSE
 */
export async function chatSpeak(audioBlob: Blob, params: {
  scenario: string;
  scenarioLabel: string;
  difficulty: string;
  wordbookWords?: ChatWord[];
  chatHistory?: ChatMessage[];
}): Promise<ReadableStream<Uint8Array>> {
  const token = localStorage.getItem('accessToken');
  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');
  formData.append('scenario', params.scenario);
  formData.append('scenarioLabel', params.scenarioLabel);
  formData.append('difficulty', params.difficulty);
  if (params.wordbookWords?.length) formData.append('wordbookWords', JSON.stringify(params.wordbookWords));
  if (params.chatHistory?.length) formData.append('chatHistory', JSON.stringify(params.chatHistory));

  const res = await fetch(`${API_BASE_URL}/chat/speak`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '对话请求失败' }));
    throw new Error(err.error || '对话请求失败');
  }

  if (!res.body) throw new Error('服务器未返回流式数据');
  return res.body;
}

/**
 * 解析 SSE 流
 */
export async function* parseSSEStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEChatEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let eventType = '';
      let eventData = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          eventData = line.slice(6);
        } else if (line.trim() === '') {
          // 空行 = 事件结束
          if (eventType && eventData) {
            try {
              yield { event: eventType, data: JSON.parse(eventData) };
            } catch {
              // 忽略解析失败的数据
            }
            eventType = '';
            eventData = '';
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export default api;
