import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { learnAPI } from '../api';
import FlashCard from '../components/FlashCard';

interface CardData {
  id: string;
  word: string;
  word_normalized: string;
  part_of_speech: string;
  gender: string;
  definite_article: string;
  chinese_meaning: string;
  original_form: string;
  wordbook_name: string;
  status: string;
  sentences: Array<{ id: string; sentence_es: string; sentence_zh: string }>;
  conjugation: Record<string, Record<string, string>>;
}

export default function LearnPage() {
  const { wordbookId } = useParams<{ wordbookId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const startCardId = searchParams.get('start') || '';
  const startSetRef = useRef(false);
  const [cards, setCards] = useState<CardData[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [complete, setComplete] = useState(false);
  const [stats, setStats] = useState({ studied: 0, correct: 0 });
  const [mode, setMode] = useState<'review' | 'all'>(wordbookId ? 'all' : 'review');

  useEffect(() => {
    loadCards();
  }, [wordbookId, mode]);

  const loadCards = async () => {
    setLoading(true);
    try {
      if (wordbookId) {
        const { data } = await learnAPI.getWordbookCards(wordbookId, mode === 'review' ? 'review' : undefined);
        const cardsWithSentences: CardData[] = (data.cards || []).map((c: any) => ({
          ...c,
          conjugation: (() => { try { return JSON.parse(c.conjugation_json || '{}'); } catch { return {}; } })(),
        }));
        setCards(cardsWithSentences);
      } else {
        const { data } = await learnAPI.getToday();
        const cardsWithSentences: CardData[] = (data.cards || []).map((c: any) => ({
          ...c,
          conjugation: (() => { try { return JSON.parse(c.conjugation_json || '{}'); } catch { return {}; } })(),
        }));
        setCards(cardsWithSentences);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  // 从词本列表点击进入时，跳转到指定卡片
  useEffect(() => {
    if (!startCardId || startSetRef.current || cards.length === 0) return;
    const idx = cards.findIndex((c) => c.id === startCardId);
    if (idx >= 0) {
      startSetRef.current = true;
      setCurrentIndex(idx);
    }
  }, [cards, startCardId]);

  const handleScore = useCallback(
    async (score: number) => {
      if (!cards[currentIndex]) return;
      setStats((prev) => ({
        studied: prev.studied + 1,
        correct: prev.correct + (score >= 3 ? 1 : 0),
      }));
      try {
        await learnAPI.score({ cardId: cards[currentIndex].id, score, mode: 'browse', timeSpent: 5 });
      } catch { /* ignore */ }
      if (currentIndex < cards.length - 1) {
        setCurrentIndex(currentIndex + 1);
      } else {
        setComplete(true);
      }
    },
    [cards, currentIndex]
  );

  const currentCard = cards[currentIndex];

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-hairline border-t-brand rounded-full animate-spin" />
      </div>
    );
  }

  if (complete) {
    return (
      <div className="page-container flex flex-col items-center justify-center min-h-[70dvh]">
        <div className="w-20 h-20 bg-success-muted rounded-pill flex items-center justify-center mb-6 border border-success/10">
          <svg className="w-10 h-10 text-success" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-display-md text-ink mb-2" style={{ fontFamily: "'Roobert PRO', 'Inter', sans-serif" }}>学习完成</h2>
        <p className="text-typo-secondary mb-1">学习了 {stats.studied} 张卡片</p>
        <p className="text-sm text-typo-muted mb-8">
          正确率 {stats.studied > 0 ? Math.round((stats.correct / stats.studied) * 100) : 0}%
        </p>
        <div className="flex gap-3">
          <button onClick={() => navigate('/')} className="btn-outline">返回首页</button>
          <button onClick={() => { setCurrentIndex(0); setComplete(false); setStats({ studied: 0, correct: 0 }); loadCards(); }} className="btn-primary">
            再来一组
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-pill hover:bg-surface">
          <svg className="w-5 h-5 text-typo-secondary" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="text-center">
          <span className="text-eyebrow uppercase text-typo-muted" style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>
            {currentIndex + 1} / {cards.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!wordbookId && (
            <select
              value={mode}
              onChange={(e) => { setMode(e.target.value as any); setCurrentIndex(0); }}
              className="text-xs text-typo-secondary bg-surface rounded-pill px-3 py-1 border border-hairline-soft"
            >
              <option value="review">待复习</option>
              <option value="all">全部</option>
            </select>
          )}
        </div>
      </div>

      <div className="w-full bg-surface rounded-pill h-1 mb-6">
        <div className="h-full bg-brand rounded-pill transition-all duration-300" style={{ width: `${(currentIndex / cards.length) * 100}%` }} />
      </div>

      {currentCard ? (
        <FlashCard key={currentCard.id} card={currentCard} onScore={handleScore} showScore={true} />
      ) : (
        <div className="text-center py-16">
          <p className="text-typo-muted mb-3">没有需要复习的卡片</p>
          <button onClick={() => navigate('/')} className="btn-outline text-sm">返回首页</button>
        </div>
      )}

      {cards.length > 0 && (
        <div className="fixed bottom-20 md:bottom-6 left-0 right-0 flex justify-center pointer-events-none">
          <div className="bg-canvas/95 backdrop-blur-sm rounded-pill px-4 py-2 border border-hairline-soft flex gap-4 text-xs text-typo-secondary pointer-events-auto"
               style={{ boxShadow: 'rgba(5,0,56,0.08) 0px 4px 16px' }}>
            <span style={{ fontFamily: "'Geist Mono', monospace" }}>正确 {stats.correct}</span>
            <span style={{ fontFamily: "'Geist Mono', monospace" }}>{stats.studied}/{cards.length}</span>
          </div>
        </div>
      )}
    </div>
  );
}
