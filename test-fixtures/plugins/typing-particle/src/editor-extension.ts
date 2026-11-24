import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { EditorExtension, PluginConfigReader } from '@texto/markdown-editor-api';

import { CanvasLayer } from './canvas-layer';
import { ParticleSystem } from './particle-system';
import { clampConfig } from './config';

function typingParticlePlugin(config: PluginConfigReader): Plugin {
  let canvasLayer: CanvasLayer | null = null;
  let particleSystem: ParticleSystem | null = null;

  function init(view: EditorView): void {
    if (canvasLayer) return;
    const container = view.dom.parentElement;
    if (!container) return;
    canvasLayer = new CanvasLayer({ container });
    particleSystem = new ParticleSystem();
    particleSystem.setContext(canvasLayer.ctx);
    particleSystem.setEnabled(true);
  }

  function destroy(): void {
    if (particleSystem) {
      particleSystem.setEnabled(false);
      particleSystem.destroy();
      particleSystem = null;
    }
    if (canvasLayer) {
      canvasLayer.destroy();
      canvasLayer = null;
    }
  }

  return new Plugin({
    view: () => ({
      // 首次 update 时容器已挂载，再初始化画布（沿用旧实现的时序）。
      update: (view) => {
        if (!canvasLayer) init(view);
      },
      destroy: () => destroy(),
    }),
    props: {
      handleTextInput(view, _from, _to, _text) {
        if (!particleSystem) return false;
        const coords = view.coordsAtPos(view.state.selection.$head.pos);
        if (coords) {
          const containerRect = view.dom.parentElement!.getBoundingClientRect();
          particleSystem.emit(
            coords.left - containerRect.left,
            coords.top - containerRect.top,
            clampConfig(config.all()),
          );
        }
        return false;
      },
    },
  });
}

export const typingParticleEditorExtension: EditorExtension = {
  id: 'typing-particle.editor',
  create(ctx) {
    return { plugins: [typingParticlePlugin(ctx.config)] };
  },
};
