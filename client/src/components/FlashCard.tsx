import { useState } from 'react';
import { useTTS } from '../hooks/useTTS';

interface CardData {
  id: string;
  word: string;
  word_normalized: string;
  part_of_speech: string;
  gender: string;
  definite_article: string;
  chinese_meaning: string;
  original_form: string;
  audio_url?: string;
  sentences: Array<{ id: string; sentence_es: string; sentence_zh: string; audio_url?: string }>;
  conjugation: Record<string, Record<string, string>>;
}

interface Props {
  card: CardData;
  onScore?: (score: number) => void;
  showScore?: boolean;
}

export default function FlashCard({ card, onScore, showScore = true }: Props) {
  const [flipped, setFlipped] = useState(false);
  const { speakOrPlay, speaking, rate, setRate } = useTTS();

  const posLabel: Record<string, string> = {
    sustantivo: '名词',
    verbo: '动词',
    adjetivo: '形容词',
    adverbio: '副词',
    preposición: '介词',
    conjunción: '连词',
    pronombre: '代词',
    artículo: '冠词',
    interjección: '感叹词',
  };

  const genderLabel: Record<string, string> = {
    masculino: '阳',
    femenino: '阴',
    común: '阴阳同形',
  };

  const handleFlip = () => {
    if (!flipped) {
      speakOrPlay(card.word);
    }
    setFlipped(!flipped);
  };

  return (
    <div className="w-full">
      {/* Card */}
      <div
        className="perspective-1000 cursor-pointer select-none"
        style={{ minHeight: '340px' }}
        onClick={handleFlip}
      >
        <div className={`card-flip ${flipped ? 'flipped' : ''}`} style={{ minHeight: '340px' }}>
          {/* Front */}
          <div className="card-face bg-white flex flex-col items-center justify-center p-8">
            {card.part_of_speech && (
              <span className="text-sm text-text-muted mb-2">
                {posLabel[card.part_of_speech] || card.part_of_speech}
                {card.gender && (
                  <span className="ml-1 text-xs bg-bg-dark px-1.5 py-0.5 rounded">
                    {genderLabel[card.gender] || card.gender}
                  </span>
                )}
              </span>
            )}
            <h2 className="text-3xl font-bold text-text-primary text-center mb-1">
              {card.word}
            </h2>
            {card.definite_article && (
              <span className="text-sm text-primary font-medium">
                {card.definite_article}
              </span>
            )}
            {card.original_form !== card.word && (
              <span className="text-xs text-text-muted mt-1">
                原形: {card.original_form}
              </span>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                speakOrPlay(card.word);
              }}
              className={`mt-6 w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                speaking
                  ? 'bg-primary text-white pulse-playing'
                  : 'bg-primary-50 text-primary hover:bg-primary-100'
              }`}
              title="播放发音 (TTS)"
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8.5v7a4.47 4.47 0 002.5-3.5zM14 3.23v2.06a7.007 7.007 0 010 13.42v2.06A9.01 9.01 0 0021 12a9 9 0 00-7-8.77z" />
              </svg>
            </button>

            <p className="text-xs text-text-muted mt-4">点击翻转查看释义</p>
          </div>

          {/* Back */}
          <div className="card-face card-back bg-white p-6 flex flex-col">
            <div className="text-center mb-4">
              <h3 className="text-2xl font-bold text-primary">{card.chinese_meaning || '暂未释义'}</h3>
              {card.word !== card.original_form && card.original_form && (
                <p className="text-sm text-text-muted mt-1">原形: {card.original_form}</p>
              )}
            </div>

            {/* Conjugation table for verbs */}
            {card.part_of_speech === 'verbo' && card.conjugation && Object.keys(card.conjugation).length > 0 && (
              <div className="mb-4 p-3 bg-bg-dark rounded-lg text-xs">
                <p className="font-medium text-text-secondary mb-2">动词变位</p>
                <div className="grid grid-cols-2 gap-1">
                  {Object.entries(card.conjugation).map(([person, form]) => (
                    <div key={person} className="flex justify-between px-2 py-0.5">
                      <span className="text-text-muted">{person}:</span>
                      <span className="font-medium text-text-primary">{String(form)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 造句段落 - 每条独立播放按钮 */}
            {card.sentences && card.sentences.length > 0 && (
              <div className="flex-1 overflow-y-auto p-4 bg-primary-50 rounded-lg">
                <p className="text-xs font-medium text-text-muted mb-2">造句</p>
                {card.sentences.map((s, idx) => (
                  <div key={s.id || idx} className="mb-3 last:mb-0">
                    <p className="text-sm text-text-primary leading-relaxed">
                      {s.sentence_es}
                    </p>
                    <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
                      {s.sentence_zh}
                    </p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        speakOrPlay(s.sentence_es);
                      }}
                      className="mt-1 flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-white text-primary border border-primary-200 hover:bg-primary hover:text-white transition-colors"
                    >
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8.5v7a4.47 4.47 0 002.5-3.5zM14 3.23v2.06a7.007 7.007 0 010 13.42v2.06A9.01 9.01 0 0021 12a9 9 0 00-7-8.77z" />
                      </svg>
                      TTS
                    </button>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-text-muted text-center mt-4">点击翻转回正面</p>
          </div>
        </div>
      </div>

      {/* Rate control */}
      <div className="flex items-center justify-center gap-2 mt-4 mb-2">
        <span className="text-xs text-text-muted">语速:</span>
        {([0.5, 0.75, 1, 1.25, 1.5] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRate(r)}
            className={`px-2 py-0.5 text-xs rounded-full transition-colors ${
              rate === r
                ? 'bg-primary text-white'
                : 'bg-bg-dark text-text-secondary hover:bg-gray-200'
            }`}
          >
            {r}x
          </button>
        ))}
      </div>

      {/* Score buttons */}
      {showScore && flipped && onScore && (
        <div className="grid grid-cols-4 gap-2 mt-4">
          <button onClick={() => { onScore(0); setFlipped(false); }} className="py-3 rounded-btn bg-red-50 text-danger text-sm font-medium active:bg-red-100">
            忘记了
          </button>
          <button onClick={() => { onScore(1); setFlipped(false); }} className="py-3 rounded-btn bg-orange-50 text-orange-600 text-sm font-medium active:bg-orange-100">
            有印象
          </button>
          <button onClick={() => { onScore(3); setFlipped(false); }} className="py-3 rounded-btn bg-green-50 text-success text-sm font-medium active:bg-green-100">
            记住了
          </button>
          <button onClick={() => { onScore(4); setFlipped(false); }} className="py-3 rounded-btn bg-primary-50 text-primary text-sm font-medium active:bg-primary-100">
            太简单
          </button>
        </div>
      )}
    </div>
  );
}
