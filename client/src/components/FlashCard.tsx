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
  const { speakOrPlay, speaking, ttsLoading, rate, setRate } = useTTS();

  const posLabel: Record<string, string> = {
    sustantivo: '名词',
    verbo: '动词',
    adjetivo: '形容词',
    adverbio: '副词',
    preposicion: '介词',
    conjuncion: '连词',
    pronombre: '代词',
    articulo: '冠词',
    interjeccion: '感叹词',
  };

  const genderLabel: Record<string, string> = {
    masculino: '阳',
    femenino: '阴',
    comun: '阴阳同形',
  };

  const handleFlip = () => {
    if (!flipped) {
      speakOrPlay(card.word, card.audio_url);
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
          <div className="card-face bg-canvas flex flex-col items-center justify-center p-8 border border-hairline-soft">
            {card.part_of_speech && (
              <span className="text-eyebrow uppercase text-typo-muted mb-3"
                    style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>
                {posLabel[card.part_of_speech] || card.part_of_speech}
                {card.gender && (
                  <span className="ml-1 inline-block bg-surface rounded-pill px-2 py-0.5">
                    {genderLabel[card.gender] || card.gender}
                  </span>
                )}
              </span>
            )}
            <h2 className="text-display-md text-ink text-center mb-2"
                style={{ fontFamily: "'Roobert PRO', 'Inter', sans-serif" }}>
              {card.word}
            </h2>
            {card.definite_article && (
              <span className="text-sm text-typo-secondary font-medium">
                {card.definite_article}
              </span>
            )}
            {card.original_form !== card.word && (
              <span className="text-xs text-typo-muted mt-1">
                原形: {card.original_form}
              </span>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                speakOrPlay(card.word, card.audio_url);
              }}
              disabled={ttsLoading}
              className={`mt-6 w-14 h-14 rounded-pill flex items-center justify-center transition-all duration-200 border ${
                speaking
                  ? 'bg-accent-muted border-accent/30 text-accent pulse-playing'
                  : ttsLoading
                  ? 'bg-surface border-hairline text-typo-disabled'
                  : 'bg-surface border-hairline-soft text-typo-secondary hover:bg-surface-hover hover:border-hairline'
              }`}
              title="播放发音 (TTS)"
            >
              {ttsLoading ? (
                <span className="w-5 h-5 border-2 border-hairline border-t-accent rounded-full animate-spin" />
              ) : (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8.5v7a4.47 4.47 0 002.5-3.5zM14 3.23v2.06a7.007 7.007 0 010 13.42v2.06A9.01 9.01 0 0021 12a9 9 0 00-7-8.77z" />
                </svg>
              )}
            </button>

            <p className="text-xs text-typo-muted mt-4">点击翻转查看释义</p>
          </div>

          {/* Back */}
          <div className="card-face card-back bg-canvas p-6 flex flex-col border border-hairline-soft">
            <div className="text-center mb-4">
              <h3 className="text-2xl font-medium text-ink"
                  style={{ fontFamily: "'Roobert PRO', 'Inter', sans-serif" }}>
                {card.chinese_meaning || '暂未释义'}
              </h3>
              {card.word !== card.original_form && card.original_form && (
                <p className="text-sm text-typo-muted mt-1">原形: {card.original_form}</p>
              )}
            </div>

            {/* Conjugation table for verbs */}
            {card.part_of_speech === 'verbo' && card.conjugation && Object.keys(card.conjugation).length > 0 && (
              <div className="mb-4 p-3 bg-surface rounded-card border border-hairline-soft text-xs">
                <p className="font-medium text-typo-secondary mb-2 text-eyebrow uppercase"
                   style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>
                  动词变位
                </p>
                <div className="grid grid-cols-2 gap-1">
                  {Object.entries(card.conjugation).map(([person, form]) => (
                    <div key={person} className="flex justify-between px-2 py-0.5">
                      <span className="text-typo-muted">{person}:</span>
                      <span className="font-medium text-ink">{String(form)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 造句段落 */}
            {card.sentences && card.sentences.length > 0 && (
              <div className="flex-1 overflow-y-auto p-4 bg-surface rounded-card border border-hairline-soft">
                <p className="text-eyebrow uppercase text-typo-muted mb-2"
                   style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>
                  造句
                </p>
                {card.sentences.map((s, idx) => (
                  <div key={s.id || idx} className="mb-3 last:mb-0">
                    <p className="text-sm text-ink leading-relaxed">
                      {s.sentence_es}
                    </p>
                    <p className="text-xs text-typo-muted mt-0.5 leading-relaxed">
                      {s.sentence_zh}
                    </p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        speakOrPlay(s.sentence_es, s.audio_url);
                      }}
                      disabled={ttsLoading}
                      className="mt-1.5 flex items-center gap-1 px-3 py-1 rounded-pill text-xs
                                 border border-hairline text-typo-secondary
                                 hover:text-ink hover:border-hairline-strong transition-all duration-200
                                 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {ttsLoading ? (
                        <span className="w-3 h-3 border-2 border-hairline border-t-accent rounded-full animate-spin" />
                      ) : (
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8.5v7a4.47 4.47 0 002.5-3.5zM14 3.23v2.06a7.007 7.007 0 010 13.42v2.06A9.01 9.01 0 0021 12a9 9 0 00-7-8.77z" />
                        </svg>
                      )}
                      TTS
                    </button>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-typo-muted text-center mt-4">点击翻转回正面</p>
          </div>
        </div>
      </div>

      {/* Rate control */}
      <div className="flex items-center justify-center gap-2 mt-4 mb-2">
        <span className="text-eyebrow uppercase text-typo-muted"
              style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>
          语速
        </span>
        {([0.5, 0.75, 1, 1.25, 1.5] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRate(r)}
            className={`px-2 py-0.5 text-xs rounded-pill font-medium transition-all duration-200 ${
              rate === r
                ? 'bg-brand text-white'
                : 'text-typo-secondary hover:text-ink hover:bg-surface'
            }`}
          >
            {r}x
          </button>
        ))}
      </div>

      {/* Score buttons */}
      {showScore && flipped && onScore && (
        <div className="grid grid-cols-4 gap-2 mt-4">
          {[
            { score: 0, label: '忘记了', cls: 'bg-danger-muted text-danger border-danger/10' },
            { score: 1, label: '有印象', cls: 'bg-warning-muted text-warning border-warning/10' },
            { score: 3, label: '记住了', cls: 'bg-success-muted text-success border-success/10' },
            { score: 4, label: '太简单', cls: 'bg-accent-muted text-accent border-accent/10' },
          ].map(({ score, label, cls }) => (
            <button
              key={score}
              onClick={() => { onScore(score); setFlipped(false); }}
              className={`py-3 rounded-pill text-sm font-medium border transition-all duration-200 active:scale-[0.97] ${cls}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
