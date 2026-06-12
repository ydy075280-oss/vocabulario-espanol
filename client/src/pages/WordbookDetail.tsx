import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { wordbookAPI, cardAPI } from '../api';
import { useTTS } from '../hooks/useTTS';

interface Card {
  id: string;
  word: string;
  part_of_speech: string;
  gender: string;
  chinese_meaning: string;
  status: string;
  sentences: Array<{ sentence_es: string }>;
}

export default function WordbookDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { speak } = useTTS();
  const [wordbook, setWordbook] = useState<any>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newWord, setNewWord] = useState({ word: '', chineseMeaning: '', partOfSpeech: '', gender: '', exampleSentence: '' });

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]);

  const loadData = async () => {
    try {
      const { data } = await wordbookAPI.get(id!);
      setWordbook(data.wordbook);
      setCards(data.cards || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const addCard = async () => {
    if (!newWord.word || !id) return;
    try {
      await cardAPI.create({
        wordbookId: id,
        word: newWord.word,
        chineseMeaning: newWord.chineseMeaning,
        partOfSpeech: newWord.partOfSpeech,
        gender: newWord.gender,
        exampleSentence: newWord.exampleSentence,
      });
      setNewWord({ word: '', chineseMeaning: '', partOfSpeech: '', gender: '', exampleSentence: '' });
      setShowAdd(false);
      loadData();
    } catch { /* ignore */ }
  };

  const deleteCard = async (cardId: string, word: string) => {
    if (!confirm(`删除"${word}"？`)) return;
    try {
      await cardAPI.delete(cardId);
      setCards((prev) => prev.filter((c) => c.id !== cardId));
    } catch { /* ignore */ }
  };

  const filtered = search
    ? cards.filter(
        (c) =>
          c.word.toLowerCase().includes(search.toLowerCase()) ||
          c.chinese_meaning.includes(search)
      )
    : cards;

  const getStatusBadge = (status: string) => {
    const map: Record<string, string> = {
      new: 'bg-gray-100 text-gray-600',
      learning: 'bg-yellow-100 text-yellow-700',
      mastered: 'bg-green-100 text-green-700',
    };
    const label: Record<string, string> = { new: '新学', learning: '学习中', mastered: '已掌握' };
    return { className: map[status] || '', label: label[status] || status };
  };

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!wordbook) {
    return (
      <div className="page-container text-center py-16">
        <p className="text-text-muted">单词本不存在</p>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2">
          <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-text-primary">{wordbook.name}</h1>
          <p className="text-xs text-text-muted">
            {wordbook.teacher_tag && `${wordbook.teacher_tag} · `}
            {cards.length} 张卡片 · {wordbook.source_type}
          </p>
        </div>
        <button onClick={() => navigate(`/learn/${id}`)} className="btn-primary text-sm py-1.5 px-4">
          学习
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜索单词..."
        className="input-field mb-4"
      />

      {/* Add button */}
      <button
        onClick={() => setShowAdd(true)}
        className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-text-muted text-sm hover:border-primary hover:text-primary transition-colors mb-4"
      >
        + 手动添加单词
      </button>

      {/* Add modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-t-2xl w-full max-w-lg p-6 max-h-[85dvh] overflow-y-auto animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">添加单词</h2>
            <input type="text" value={newWord.word} onChange={(e) => setNewWord((p) => ({ ...p, word: e.target.value }))} placeholder="西班牙语单词（含重音）" className="input-field mb-3" />
            <input type="text" value={newWord.chineseMeaning} onChange={(e) => setNewWord((p) => ({ ...p, chineseMeaning: e.target.value }))} placeholder="中文释义" className="input-field mb-3" />
            <div className="grid grid-cols-2 gap-2 mb-3">
              <input type="text" value={newWord.partOfSpeech} onChange={(e) => setNewWord((p) => ({ ...p, partOfSpeech: e.target.value }))} placeholder="词性" className="input-field" />
              <select value={newWord.gender} onChange={(e) => setNewWord((p) => ({ ...p, gender: e.target.value }))} className="input-field">
                <option value="">阴阳性</option>
                <option value="masculino">阳性 (m.)</option>
                <option value="femenino">阴性 (f.)</option>
              </select>
            </div>
            <input type="text" value={newWord.exampleSentence} onChange={(e) => setNewWord((p) => ({ ...p, exampleSentence: e.target.value }))} placeholder="例句（可选）" className="input-field mb-4" />
            <div className="flex gap-2">
              <button onClick={() => setShowAdd(false)} className="btn-secondary flex-1">取消</button>
              <button onClick={addCard} className="btn-primary flex-1" disabled={!newWord.word}>添加</button>
            </div>
          </div>
        </div>
      )}

      {/* Cards list */}
      <div className="space-y-2">
        {filtered.map((card) => {
          const badge = getStatusBadge(card.status);
          return (
            <div key={card.id} className="card flex items-center gap-3 group">
              <button
                onClick={() => speak(card.word)}
                className="p-2 text-primary hover:bg-primary-50 rounded-lg transition-colors shrink-0"
                title="播放发音"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8.5v7a4.47 4.47 0 002.5-3.5z" />
                </svg>
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-text-primary">{card.word}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${badge.className}`}>
                    {badge.label}
                  </span>
                </div>
                <p className="text-sm text-text-muted truncate">
                  {card.chinese_meaning}
                  {card.gender && ` · ${card.gender === 'masculino' ? '阳' : '阴'}`}
                </p>
              </div>
              <button
                onClick={() => deleteCard(card.id, card.word)}
                className="p-2 text-text-muted hover:text-danger rounded-lg opacity-0 group-hover:opacity-100 transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-12 text-text-muted">
            {search ? '没有找到匹配的单词' : '还没有单词卡片'}
          </div>
        )}
      </div>
    </div>
  );
}
