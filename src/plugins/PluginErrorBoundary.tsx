import { Component, type ErrorInfo, type ReactNode } from 'react';

import { logger } from '@/utils/logger';

interface Props {
  children: ReactNode;
  /** 出错提示的标题；缺省为编辑器槽位文案（`FileEditorHost` 不需要传）。 */
  title?: string;
}

interface State {
  error: Error | null;
}

/**
 * 插件渲染护栏：某个插件贡献的 UI 在渲染期抛错时，只把该槽位替换为
 * 提示（并可重试），而不是让整棵 React 树卸载导致白屏。
 */
export class PluginErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('[plugins] editor render crashed:', error, info.componentStack);
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error) {
      const { title = '编辑器渲染出错' } = this.props;
      return (
        <div className="plugin-editor-error" role="alert">
          <div className="plugin-editor-error-title">{title}</div>
          <pre className="plugin-editor-error-detail">{error.message}</pre>
          <button
            type="button"
            className="plugin-editor-error-retry"
            onClick={this.handleRetry}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
