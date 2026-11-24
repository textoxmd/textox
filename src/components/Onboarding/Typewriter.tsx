import { useEffect, useMemo, useState } from 'react';

interface TypewriterProps {
  text: string;
}

/** 标点（中英文/阿拉伯语常见标点，打字到其后停顿更久） */
const PUNCTUATION = /[，。、；：？！.,!?;:،؟…]/;

/** 拟人化逐字打印：速度随机波动，标点后停顿，偶尔思考停顿或快速连打 */
export function Typewriter({ text }: TypewriterProps) {
  const chars = useMemo(() => Array.from(text), [text]);
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(0);
    if (chars.length === 0) return;

    let timer: number;
    let current = 0;

    /** 计算「打出 index 字符」前的间隔（index 之前的字符刚打完） */
    const nextDelay = (index: number) => {
      const prev = chars[index - 1];
      const afterPunctuation = prev !== undefined && PUNCTUATION.test(prev);
      // 基础速度：每字 50–120ms 随机波动
      let delay = 50 + Math.random() * 70;
      // 标点后停顿更久，像人在断句
      if (afterPunctuation) delay += 160 + Math.random() * 220;
      // 偶尔“思考”停顿
      else if (Math.random() < 0.12) delay += 120 + Math.random() * 220;
      // 偶尔快速连打（突发输入）
      else if (Math.random() < 0.1) delay = 25 + Math.random() * 20;
      return delay;
    };

    const typeChar = () => {
      current += 1;
      setCount(current);
      if (current >= chars.length) return;
      timer = window.setTimeout(typeChar, nextDelay(current));
    };

    // 开始前先“酝酿”一下（100–300ms）
    timer = window.setTimeout(typeChar, 100 + Math.random() * 200);
    return () => window.clearTimeout(timer);
  }, [chars]);

  const done = count >= chars.length;
  return (
    <>
      {chars.slice(0, count).join('')}
      {!done && <span className="typing-caret" aria-hidden="true" />}
    </>
  );
}
