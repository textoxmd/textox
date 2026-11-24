import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronsUpDown } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface ModelPickerProps {
  value: string;
  /** 推荐模型（预置目录 + 当前已填写的模型）。 */
  options: readonly string[];
  disabled?: boolean;
  onChange(model: string): void;
}

/**
 * 模型选择器：预设模型可点选，也可直接输入目录外的 model id。
 *
 * 用 Popover + Command 组合（shadcn 的 combobox 写法），而不是原生 select：
 * 模型 id 迭代很快，允许手填是刚需。
 */
export function ModelPicker({ value, options, disabled, onChange }: ModelPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const keyword = query.trim();
  const matches = useMemo(() => {
    if (!keyword) return options;
    const lowered = keyword.toLowerCase();
    return options.filter((option) => option.toLowerCase().includes(lowered));
  }, [keyword, options]);
  const canUseTyped = keyword.length > 0 && !options.includes(keyword);

  const choose = (model: string) => {
    onChange(model);
    setQuery('');
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            aria-label={t('settings.ai.model', '模型')}
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'w-full justify-between font-normal',
            )}
          >
            <span className={`truncate ${value ? '' : 'text-muted-foreground'}`}>
              {value || t('settings.ai.modelPlaceholder', '搜索或输入模型 id')}
            </span>
            <ChevronsUpDown className="size-4 opacity-50" />
          </button>
        }
      />
      <PopoverContent className="w-(--anchor-width) min-w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t('settings.ai.modelPlaceholder', '搜索或输入模型 id')}
          />
          <CommandList>
            <CommandEmpty>{t('settings.ai.noModelMatch', '没有匹配的预设模型')}</CommandEmpty>
            <CommandGroup>
              {matches.map((model) => (
                <CommandItem key={model} value={model} onSelect={() => choose(model)}>
                  {model}
                </CommandItem>
              ))}
              {canUseTyped && (
                <CommandItem value={`typed:${keyword}`} onSelect={() => choose(keyword)}>
                  {t('settings.ai.modelUseTyped', '直接使用「{{model}}」', { model: keyword })}
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
