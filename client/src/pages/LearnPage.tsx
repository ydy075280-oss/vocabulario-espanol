import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
        // Today's review
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

  const handleScore = useCallback(
    async (score: number) => {
      if (!cards[currentIndex]) return;

      // Update local stats
      setStats((prev) => ({
        studied: prev.studied + 1,
        correct: prev.correct + (score >= 3 ? 1 : 0),
      }));

      // Submit to server
      try {
        await learnAPI.score({
          cardId: cards[currentIndex].id,
          score,
          mode: 'browse',
          timeSpent: 5,
        });
      } catch { /* ignore */ }

      // Move to next card
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
        <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (complete) {
    return (
      <div className="page-container flex flex-col items-center justify-center min-h-[70dvh]">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
          <svg className="w-10 h-10 text-success" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-text-primary mb-2">学习完成！🎉</h2>
        <p className="text-text-secondary mb-1">
          学习了 {stats.studied} 张卡片
        </p>
        <p className="text-sm text-text-muted mb-8">
          正确率 {stats.studied > 0 ? Math.round((stats.correct / stats.studied) * 100) : 0}%
        </p>
        <div className="flex gap-3">
          <button onClick={() => navigate('/')} className="btn-secondary">
            返回首页
          </button>
          <button
            onClick={() => {
              setCurrentIndex(0);
              setComplete(false);
              setStats({ studied: 0, correct: 0 });
              loadCards();
            }}
            className="btn-primary"
          >
            再来一组
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2">
          <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="text-center">
          <span className="text-sm font-medium text-text-secondary">
            {currentIndex + 1} / {cards.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!wordbookId && (
            <select
              value={mode}
              onChange={(e) => { setMode(e.target.value as any); setCurrentIndex(0); }}
              className="text-xs text-text-secondary bg-bg-dark rounded px-2 py-1"
            >
              <option value="review">待复习</option>
              <option value="all">全部</option>
            </select>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-1 mb-6">
        <div
          className="h-full bg-primary rounded-full transition-all duration-300"
          style={{ width: `${(currentIndex / cards.length) * 100}%` }}
        />
      </div>

      {/* Current card */}
      {currentCard ? (
        <FlashCard
          key={currentCard.id}
          card={currentCard}
          onScore={handleScore}
          showScore={true}
        />
      ) : (
        <div className="text-center py-16">
          <p className="text-text-muted mb-3">没有需要复习的卡片</p>
          <button onClick={() => navigate('/')} className="btn-primary text-sm">
            返回首页
          </button>
        </div>
      )}

      {/* Stats bar */}
      {cards.length > 0 && (
        <div className="fixed bottom-20 left-0 right-0 flex justify-center pointer-events-none">
          <div className="bg-white/90 backdrop-blur-sm rounded-full px-4 py-2 shadow-sm flex gap-4 text-xs text-text-secondary pointer-events-auto">
            <span>✅ {stats.correct}</span>
            <span>📚 {stats.studied}/{cards.length}</span>
          </div>
        </div>
      )}
    </div>
  );
}
