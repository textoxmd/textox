import { WheelPicker } from '@ncdai/react-wheel-picker';
import '@ncdai/react-wheel-picker/style.css';

interface LanguageWheelProps {
  languages: { code: string; name: string }[];
  defaultValue: string;
  onChange: (code: string) => void;
}

/**
 * 苹果时钟式滚轮选择器（基于 @ncdai/react-wheel-picker）：
 * 平滑惯性滚动、拖拽、键盘导航、type-ahead 搜索，样式套用项目主题变量。
 */
export function LanguageWheel({ languages, defaultValue, onChange }: LanguageWheelProps) {
  return (
    <WheelPicker
      options={languages.map((lang) => ({
        value: lang.code,
        label: lang.name,
        textValue: lang.name,
      }))}
      // 非受控：初始值即配置语言；切换语言时不回写 value，
      // 避免打断滚动动画导致位置抖动
      defaultValue={defaultValue}
      onValueChange={(code) => onChange(code)}
      visibleCount={8}
      optionItemHeight={36}
      infinite={false}
      // 手感：scroll 越低步进越"重"（落定更慢），drag 越高甩动位移越短
      scrollSensitivity={4}
      dragSensitivity={6}
      classNames={{
        optionItem: 'text-sm text-muted-foreground',
        highlightWrapper: 'rounded-lg bg-muted',
        highlightItem: 'font-medium text-primary',
      }}
    />
  );
}
