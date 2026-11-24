import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { FileText } from 'lucide-react';

interface DependencyItem {
  name: string;
  url: string;
}

const CORE_DEPENDENCIES: DependencyItem[] = [
  { name: 'Tauri', url: 'tauri.app' },
  { name: 'React', url: 'react.dev' },
  { name: 'ProseMirror', url: 'prosemirror.net' },
  { name: 'CodeMirror', url: 'codemirror.net' },
  { name: 'Tailwind CSS', url: 'tailwindcss.com' },
  { name: 'shadcn/ui', url: 'ui.shadcn.com' },
  { name: 'Trae', url: 'trae.ai' },
  { name: 'Kimi K2.5', url: 'kimi.moonshot.cn' },
];

export function Acknowledgments() {
  const { t } = useTranslation();

  // 打开鸣谢窗口
  const handleOpenAcknowledgmentsWindow = async () => {
    try {
      await invoke('create_acknowledgments_window');
    } catch (error) {
      console.error('Failed to open acknowledgments window:', error);
      toast.error(t('settings.openAcknowledgmentsFailed', '打开鸣谢窗口失败'));
    }
  };

  return (
    <div className="acknowledgments-simple-container">
      <div className="acknowledgments-simple-content">
        <img
          src="/icon.png"
          alt="Textox"
          className="acknowledgments-simple-icon"
          draggable={false}
        />
        <h1 className="acknowledgments-simple-title">Textox</h1>
        <p className="acknowledgments-simple-subtitle">
          {t('settings.acknowledgmentsSubtitle', '基于以下优秀项目构建')}
        </p>

        <Card className="acknowledgments-simple-card">
          <CardContent className="acknowledgments-simple-list">
            {CORE_DEPENDENCIES.map((item) => (
              <div key={item.name} className="acknowledgments-simple-item">
                <span className="acknowledgments-simple-name">{item.name}</span>
                <span className="acknowledgments-simple-url">{item.url}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* 查看完整鸣谢按钮 */}
        <Button
          variant="outline"
          className="acknowledgments-view-full-btn"
          onClick={handleOpenAcknowledgmentsWindow}
        >
          <FileText className="h-4 w-4 mr-2" />
          {t('settings.viewFullAcknowledgments', '查看完整鸣谢')}
        </Button>

        <p className="acknowledgments-simple-thanks">
          {t('settings.thanksMessage', '感谢所有支持')} ❤️
        </p>
      </div>
    </div>
  );
}
