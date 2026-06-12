"""
Whisper ASR with word-level timestamps
用法: python whisper_asr.py <audio_path> [--model base|small|medium] [--language es]
输出: JSON 到 stdout
"""
import sys
import json
import argparse
import re
from faster_whisper import WhisperModel

def normalize_text(text):
    """归一化文本用于匹配：去重音、标点、小写"""
    text = text.lower().strip()
    # 去重音
    text = re.sub(r'[\u0300-\u036f]', '', text)
    # 去标点
    text = re.sub(r'[.,!?;:¿¡"\'«»()\[\]{}—–\-]', ' ', text)
    # 合并空格
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def main():
    parser = argparse.ArgumentParser(description="Whisper ASR with word-level timestamps")
    parser.add_argument("audio_path", help="音频文件路径")
    parser.add_argument("--model", default="small", help="模型大小: tiny, base, small, medium (默认: small)")
    parser.add_argument("--language", default="es", help="语言代码 (默认: es)")
    parser.add_argument("--device", default="cpu", help="设备 (默认: cpu)")
    parser.add_argument("--compute_type", default="int8", help="计算类型 (默认: int8)")
    args = parser.parse_args()

    try:
        model = WhisperModel(
            args.model,
            device=args.device,
            compute_type=args.compute_type,
            num_workers=2,
        )

        segments, info = model.transcribe(
            args.audio_path,
            language=args.language,
            beam_size=5,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=300,
                threshold=0.4,
            ),
        )

        all_words = []       # 所有词的列表（含时间戳）
        word_texts = []      # 纯词文本列表（用于拼接）
        normalized_texts = []  # 归一化后的词文本列表（用于匹配）

        for seg in segments:
            if seg.words:
                for w in seg.words:
                    raw_word = w.word.strip()
                    all_words.append({
                        "start": round(w.start, 3),
                        "end": round(w.end, 3),
                        "word": raw_word,
                        "probability": round(w.probability, 4) if w.probability else 0,
                    })
                    word_texts.append(raw_word)
                    normalized_texts.append(normalize_text(raw_word))

        # 拼成全文本（带边界词索引）
        full_text = " ".join(word_texts)
        full_text_normalized = " ".join(normalized_texts)

        result = {
            "success": True,
            "language": info.language,
            "language_probability": round(info.language_probability, 4),
            "duration": round(info.duration, 2),
            "full_text": full_text,
            "full_text_normalized": full_text_normalized,
            "words": all_words,
            "normalized_words": normalized_texts,  # 归一化后的词列表（用于快速匹配）
            "word_count": len(all_words),
        }

        # 打印结果到 stdout
        json_str = json.dumps(result, ensure_ascii=False)
        print(json_str)

    except Exception as e:
        error_result = {
            "success": False,
            "error": str(e),
        }
        print(json.dumps(error_result, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
