import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  lazy,
  Suspense,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Folder, FilePlus, Settings, FileSearch, Heading1, Heading2, Heading3, Image, PenTool, Search } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { FileEditorHost } from './plugins/FileEditorHost';
import { createPluginHost, installHostDeps } from './plugins/host';
import { listFileEditors, listCommandsWithOwner, listEmbeds, resolveOpenableExtensions } from './plugins/registry';
import { insertEmbedReference } from './plugins/embedInsert';
import { listExporters } from '@/utils/export';
import { useFileEditor } from './plugins/useFileEditor';
import type { FileEditorContribution, PluginHost, SelectionContextSnapshot } from './plugins/types';

import { MarkdownEditor } from './components/MarkdownEditor';
import { TextoEditorRef } from './components/TextoEditor/TextoEditorRef';

import { Sidebar, ContextMenuProvider, ShortcutProvider, FileTree, OutlineTree, OutlinePanel } from './components/sidebar';
import { useSidebar } from './hooks/useSidebar';
import { TitleBar } from './components/TitleBar';
import { EditorToolbar } from './components/EditorToolbar';
import { createSettingsWindow, IS_MAC } from './utils/windowManager';
import { toDocumentRelativePath } from './utils/documentPath';
import { readAppConfig } from '@/utils/appConfig';
import { WordCountBadge } from '@/components/WordCountBadge';
import { readSelectionContext } from './agent/selection-context';
import { useAgentSessionStatus, useAgentSessionTabLabel } from './agent/session-status';
import { isAgentTabVisible, resolveActiveTab, restoreTabAfterClose } from './agent/tab';
import type { AgentSidebarTab } from './agent/tab';
import { AGENT_SURFACE_EVENT, setAgentSurface } from './agent/surface';


import type { OutlineStyle, TempFile } from './app/types';
import { useRecentItems } from './hooks/app/useRecentItems';
import { useFileSearch } from './hooks/app/useFileSearch';
import { useAppLayout } from './hooks/app/useAppLayout';
import { useExportActions } from './hooks/app/useExportActions';
import { useStartupPrompts } from './hooks/app/useStartupPrompts';
import { resolveOnboardingWorkspace } from './components/Onboarding/onboardingStartup';
import { useWindowChrome } from './hooks/app/useWindowChrome';
import { useOutlineState } from './hooks/app/useOutlineState';
import { isSidebarOutlineVisible, shouldComputeOutline } from './hooks/app/outlineGating';
import { useAppConfig } from './hooks/app/useAppConfig';
import { useDirectoryTree } from './hooks/app/useDirectoryTree';
import { useDocumentState } from './hooks/app/core/useDocumentState';
import { useDocumentSession } from './hooks/app/core/useDocumentSession';
import { useAppCommands } from './hooks/app/useAppCommands';
import { useWindowBootstrap } from './hooks/app/useWindowBootstrap';
import { useMcpBridge } from './hooks/app/useMcpBridge';

import './components/styles';
import { Toaster } from '@/components/ui/sonner';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { CommandDialog } from '@/components/CommandDialog';
import { FileTreeSearch } from '@/components/sidebar/file-tree/FileTreeSearch';
import { SearchResults } from '@/components/sidebar/file-tree/SearchResults';
import { SEARCH_RESULT_LIMIT } from '@/components/sidebar/file-tree/search';

/** 宿主自用能力的绑定 id：嵌入插入等由骨架发起、不属任何插件回调。 */
const HOST_PLUGIN_ID = '__host__';

/** 释义面板按需加载：其依赖（streamdown 等）不进启动包。 */
const AgentPanel = lazy(() =>
  import('./agent/AgentPanel').then((module) => ({ default: module.AgentPanel })),
);

function App() {
  const { t } = useTranslation();
  const documentState = useDocumentState();
  const {
    currentFile,
    setCurrentFile,
    currentContent,
    setCurrentContent,
    setOriginalContent,
    isModified,
    setIsModified,
    editorKey,
    setEditorKey,
    fileHandle,
    setFileHandle,
    fileHandleRef,
    hasExternalConflict,
    currentFileDeleted,
    clearCurrentFileDeleted,
    currentFileRef,
    currentContentRef,
    editorMountVersionRef,
    hasBufferToKeep,
  } = documentState;
  const [openedFolderPath, setOpenedFolderPath] = useState<string | null>(() => {
    return null;
  });
  const [isSingleFileMode, setIsSingleFileMode] = useState(() => {
    return true;
  });
  // 未保存文件相关状态
  const sidebar = useSidebar();
  const { addToRecentItems, clearRecentItems, updateRecentItemPath, removeRecentItem } = useRecentItems();
  // 应用配置：设置状态与 config 同步（见 useAppConfig）。大纲样式 setter 通过 ref
  // 交给配置钩子，避免配置←→大纲的循环依赖。
  const setOutlineStyleRef = useRef<(value: OutlineStyle) => void>(() => {});
  const config = useAppConfig({ setOutlineStyleRef, setEditorKey });
  const {
    editorMode,
    typewriterEnabled,
    readableLineLength,
    autoSaveEnabled,
    saveStatus,
    setSaveStatus,
    lastSavedTime,
    setLastSavedTime,
    codeBlockWordWrap,
    showLineNumbers,
    autoCapitalize,
    showWordCount,
    showEditorToolbar,
    setShowEditorToolbar,
    isLocked,
    openableExtensions,
    appearance,
    configRef,
    toolbarStateController,
    watchExternalChanges,
    silentExternalChanges,
  } = config;
  // 可打开扩展名 = 用户配置基线 + 启用插件的扩展名 − 被禁用插件的扩展名
  // （目录树置灰 / 打开入口守卫 / 文件链接识别都读这一份）
  const effectiveOpenableExtensions = useMemo(
    () => resolveOpenableExtensions(openableExtensions),
    [openableExtensions],
  );
  // 防止重复初始化
  const hasInitializedRef = useRef(false);
  const hasSetupCloseListenerRef = useRef(false);
  const hasFileOpenedByEventRef = useRef(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [commandOpen, setCommandOpen] = useState(false);
  const [showOutline, setShowOutlineState] = useState(false);
  // 侧栏第三个视图（释义）。与「文件/大纲」互斥，仅在有释义结果时出现。
  const [showAgent, setShowAgent] = useState(false);
  const agentStatus = useAgentSessionStatus();
  const agentTabVisible = isAgentTabVisible(agentStatus);
  const agentTabLabel = useAgentSessionTabLabel();
  const agentTabText = agentTabLabel || t('agent.panelTitle');
  // 进入 AI 视图前的侧栏视图：浮回悬浮块时还原（文件/大纲）。
  const tabBeforeAgentRef = useRef<AgentSidebarTab>('files');
  // 原 setter 语义不变：切到文件/大纲即离开 AI 视图，调用方无需感知 AI tab。
  // 保留 `SetStateAction` 签名，hooks 里沿用 setter（含 updater 形式）无需改动。
  const setShowOutline = useCallback((value: SetStateAction<boolean>) => {
    setShowAgent(false);
    setShowOutlineState(value);
  }, []);
  const [commandInput, setCommandInput] = useState('');
  // 文件类型编辑器：按当前文件解析贡献，骨架持有通用句柄
  const fileEditor = useFileEditor(currentFile);
  const openFileRef = useRef<(path: string) => Promise<void>>(async () => {});
  // 宿主能力 → 运行时引用（构造 host 时先注册，避免闭包过期）
  const editorApiRef = useRef<{
    insertImageRef(src: string, alt: string): void;
    canEdit(): boolean;
    getSelectionContext(): SelectionContextSnapshot | null;
  }>({
    insertImageRef: () => {},
    canEdit: () => false,
    getSelectionContext: () => null,
  });
  const createNewDocumentRef = useRef<
    (opts: { content: string; extension?: string }) => Promise<void>
  >(async () => {});
  // 宿主能力只构造一次（内部经 ref 取运行时引用，避免闭包过期）；
  // hostFor 在其上按插件 id 绑定出各自的 host，使 config 读写落在插件自己的 store。
  const hostDeps = useMemo(
    () => ({
      getCurrentFile: () => currentFileRef.current,
      getDocumentDir: () => {
        const file = currentFileRef.current;
        if (!file) return null;
        const idx = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
        return idx >= 0 ? file.slice(0, idx) : null;
      },
      openFile: (path: string) => openFileRef.current(path),
      toDocumentRelative: (absPath: string) =>
        toDocumentRelativePath(absPath, currentFileRef.current ?? ''),
      createNewDocument: (opts: { content: string; extension?: string }) =>
        createNewDocumentRef.current(opts),
      insertImageRef: (src: string, alt: string) => editorApiRef.current.insertImageRef(src, alt),
      canEdit: () => editorApiRef.current.canEdit(),
      getSelectionContext: () => editorApiRef.current.getSelectionContext(),
    }),
    [currentFileRef],
  );
  // 新插件运行时（src/plugins/runtime）复用同一份宿主能力（读取/新建文档等）。
  // 残留竞态：createRoot().render() 是异步的，插件 onload 仍可能早于本 effect 读到 null；
  // 彻底解决需要 App 挂载完成信号（后续任务）。
  useEffect(() => {
    installHostDeps(hostDeps);
  }, [hostDeps]);
  const hostCache = useRef(new Map<string, PluginHost>()).current;
  const hostFor = useCallback(
    (pluginId: string): PluginHost => {
      let host = hostCache.get(pluginId);
      if (!host) {
        host = createPluginHost(hostDeps, pluginId);
        hostCache.set(pluginId, host);
      }
      return host;
    },
    [hostCache, hostDeps],
  );

  // 另存为后同步当前文件信息（由文件类型编辑器通过 onPathChange 触发）
  const handleFileEditorPathChange = useCallback((path: string) => {
    const name = path.split('/').pop() || path.split('\\').pop() || '';
    setCurrentFile(path);
    setFileHandle({ kind: 'persistent', path, displayName: name });
    setIsModified(false);
    addToRecentItems(path);
    invoke('create_bookmark', { path }).catch(() => {});
  }, [addToRecentItems, setCurrentFile, setFileHandle, setIsModified]);

  // 首次进入某文件类型编辑器后常驻挂载（隐藏保留），切回 Markdown 不再整实例重建。
  // 连同所属插件 id 一起保留，隐藏保留期间仍把 host 绑到正确的插件。
  const lastFileEditorRef = useRef<{
    contribution: FileEditorContribution;
    pluginId: string;
  } | null>(null);
  if (fileEditor.contribution && fileEditor.pluginId) {
    lastFileEditorRef.current = {
      contribution: fileEditor.contribution,
      pluginId: fileEditor.pluginId,
    };
  }
  const [fileEditorEverMounted, setFileEditorEverMounted] = useState(false);
  useEffect(() => {
    if (fileEditor.contribution) setFileEditorEverMounted(true);
  }, [fileEditor.contribution]);
  const isFileEditorActive = fileEditor.contribution !== null;
  const showFileEditorSlot = fileEditorEverMounted || isFileEditorActive;
  const editorRef = useRef<TextoEditorRef>(null);
  // 兜底：未保存状态被显式清掉（保存成功 / 撤销到保存点 / 外部重载）时，
  // 把编辑器会话的保存点同步到当前状态。markSaved 不触发 onChange，不会形成循环。
  useEffect(() => {
    if (!isModified) editorRef.current?.markSaved();
  }, [isModified]);
  // 大纲状态：面板可见性/样式、标题列表、滚动跳转
  const {
    outlinePanel,
    outlineStyle,
    setOutlineStyle,
    outlineVisible,
    outlineClosing,
    outlineMounted,
    changeOutlineStyle,
    outline,
    setOutline,
    scrollToLine,
    setScrollToLine,
    scrollTrigger,
    setScrollTrigger,
    scrollToHeading,
    activeOutlineIndex,
    handleOutlineClick,
    jumpToHeading,
    isOutlineMode,
    filteredHeadings,
  } = useOutlineState({
    editorRef,
    currentFile,
    editorMode,
    currentContent,
    commandInput,
  });
  setOutlineStyleRef.current = setOutlineStyle;

  const openedFolderPathRef = useRef(openedFolderPath);

  openedFolderPathRef.current = openedFolderPath;


  // 编辑器每挂载一次 version+1，确保 mount settle 在每次 remount 后只触发一次
  editorMountVersionRef.current = editorKey * 2 + (editorMode === 'sv' ? 1 : 0);

  // 使用打开文件夹时保存的路径
  const rootPath = openedFolderPath;

  // 窗口布局：宽度 / 移动端断点 / 侧边栏 DOM ref
  const { isMobileLayout, sidebarRef } = useAppLayout(sidebar.collapsed);

  // 返回本次保存最终落盘的路径（取消/失败返回 null），供调用方继续使用最新路径

  // 使用 ref 保持最新的 rootPath，避免闭包问题
  const {
    files,
    setFiles,
    renamingPath,
    setRenamingPath,
    rootPathRef,
    refreshDirectory,
    scheduleDirectoryRefresh,
    handleCreateFile,
    handleCreateFolder,
    handleDeleteFiles,
    handleRenameFile,
  } = useDirectoryTree({
    rootPath,
    currentFile,
    setCurrentFile,
    setCurrentContent,
    setOriginalContent,
    setIsModified,
    setFileHandle,
    setEditorKey,
    setOutline,
    clearCurrentFileDeleted,
    updateRecentItemPath,
  });

  const {
    searchQuery,
    searchResults,
    isSearching,
    searchOpen,
    setSearchQuery,
    handleToggleSearch,
    handleClearSearch,
  } = useFileSearch(rootPath, rootPathRef);



  // 文档核心：外部变更守卫 + 文件系统监听 + 文档生命周期（见 useDocumentSession）
  const session = useDocumentSession({
    doc: documentState,
    silentExternalChanges,
    watchExternalChanges,
    scheduleDirectoryRefresh,
    fileEditorRef: fileEditor.ref,
    editorRef,
    openedFolderPath,
    setFiles,
    sidebar,
    addToRecentItems,
    setOutline,
    setScrollToLine,
    setScrollTrigger,
    setOpenedFolderPath,
    setIsSingleFileMode,
    setShowOutline,
    openedFolderPathRef,
    autoSaveEnabled,
    setSaveStatus,
    setLastSavedTime,
  });
  const {
    handleSave,
    handleRecoverDeletedFile,
    handleOpenFile,
    handleOpenFolder,
    handleNewFile,
    handleFileSelect,
    handleOpenFileLink,
    handleFileClose,
    handleContentChange,
    handleOpenInFinder,
    openFolder,
  } = session;

  openFileRef.current = session.handleFileSelect;

  // 引导关闭后补开向导里选中的工作区：主窗口在引导期间已按旧配置初始化成空白文档，
  // 不补这一步，首次启动会停在空白窗口，直到下次启动才生效。
  const applyOnboardingStartup = useCallback(async () => {
    try {
      const cfg = await readAppConfig<{
        startup_behavior?: string;
        workspace_folder?: string | null;
      }>();
      const folder = resolveOnboardingWorkspace(cfg, {
        currentFolder: openedFolderPathRef.current,
        hasBufferToKeep: hasBufferToKeep(),
        fileHandleKind: fileHandleRef.current.kind,
      });
      if (!folder) return;
      await openFolder(folder);
      await addToRecentItems(folder);
    } catch (error) {
      console.error('[onboarding] Failed to apply startup workspace:', error);
    }
  }, [addToRecentItems, hasBufferToKeep, openFolder]);

  // 宿主运行时接线：编辑器插入原语 + 按扩展名新建临时文档
  editorApiRef.current = {
    insertImageRef: (src, alt) => editorRef.current?.insertImageRef(src, alt),
    canEdit: () => editorRef.current?.editorView?.editable === true,
    getSelectionContext: () =>
      editorMode === 'ir' ? readSelectionContext(editorRef.current?.editorView ?? null) : null,
  };
  createNewDocumentRef.current = async (opts) => {
    const newFile = await invoke<TempFile>('create_temp_file', {
      content: opts.content,
      extension: opts.extension ?? 'md',
    });
    // 与新建 Markdown 文件一致：在当前窗口以临时文件方式打开（另存为时选择位置）
    setOpenedFolderPath(null);
    setFiles([]);
    setIsSingleFileMode(true);
    setCurrentFile(newFile.path);
    setFileHandle({ kind: 'temp', path: newFile.path });
    setCurrentContent('');
    setOriginalContent('');
    setIsModified(false);
    setEditorKey((prev) => prev + 1);
    setOutline([]);
  };


  const exportActions = useExportActions({
    currentFile,
    fileHandle,
    fileHandleRef,
    currentFileRef,
    isModified,
    handleSave,
    setShowEditorToolbar,
  });
  const {
    handleCloseToolbar,
    handleExportPdf,
    handleExportPng,
    handleExport,
    handlePrint,
  } = exportActions;

  const {
    toggleEditorMode,
    toggleLock,
  } = useAppCommands({
    doc: documentState,
    config,
    session,
    exportActions,
    sidebar,
    editorRef,
    clearRecentItems,
    removeRecentItem,
    setCommandOpen,
    hostFor,
  });


  useStartupPrompts(isInitializing, applyOnboardingStartup);



  configRef.current.outlineStyle = outlineStyle;








  // 窗口启动引导与关闭守卫（见 useWindowBootstrap）
  useWindowBootstrap({
    doc: documentState,
    session,
    setFiles,
    sidebar,
    addToRecentItems,
    removeRecentItem,
    setOutline,
    setOpenedFolderPath,
    setIsSingleFileMode,
    setShowOutline,
    setIsInitializing,
    hasInitializedRef,
    hasFileOpenedByEventRef,
    hasSetupCloseListenerRef,
    fileEditorRef: fileEditor.ref,
  });

  // MCP 原型桥接：外部 AI 客户端经本机回环读写当前文档 / 工作区
  // （服务端见 src-tauri/src/mcp.rs）。
  useMcpBridge({
    doc: documentState,
    editorMode,
    editorRef,
    workspaceRoot: openedFolderPath,
    refreshDirectory,
    executeOpenFile: session.executeOpenFile,
  });

  const { currentTitle } = useWindowChrome({    currentFile,
    isModified,
    saveStatus,
    lastSavedTime,
    isInitializing,
    openedFolderPath,
    isSingleFileMode,
    sidebarCollapsed: sidebar.collapsed,
    outlineVisible,
    showOutline,
    fileHandleKind: fileHandle.kind,
  });

  // 临时文件时自动切换到大纲视图
  useEffect(() => {
    if (fileHandle.kind === 'temp') {
      setShowOutline(true);
    }
  }, [fileHandle.kind]);

  // 侧栏 AI 承载面切换：宿主只做展开 + 切 tab，不订阅会话（避免流式增量重渲染整棵树）。
  useEffect(() => {
    const onSurfaceChange = (event: Event) => {
      const surface = (event as CustomEvent<{ surface?: string }>).detail?.surface;
      if (surface === 'sidebar') {
        // 已经在 AI 视图时不覆盖「进入前」的视图，保证浮回能回到原来的 tab。
        if (!showAgent) tabBeforeAgentRef.current = showOutline ? 'outline' : 'files';
        sidebar.setCollapsed(false);
        setShowOutlineState(false);
        setShowAgent(true);
      } else if (surface === 'floating') {
        if (showAgent) setShowOutlineState(tabBeforeAgentRef.current === 'outline');
        setShowAgent(false);
      }
    };
    window.addEventListener(AGENT_SURFACE_EVENT, onSurfaceChange);
    return () => window.removeEventListener(AGENT_SURFACE_EVENT, onSurfaceChange);
  }, [sidebar.setCollapsed, showAgent, showOutline]);

  // 会话回到 idle（X 关闭）后收起释义 tab，并回到进入前的文件/大纲。
  useEffect(() => {
    if (agentTabVisible || !showAgent) return;
    const restored = restoreTabAfterClose(tabBeforeAgentRef.current, {
      hasFile: !!currentFile,
      hasRoot: !!rootPath,
    });
    setShowAgent(false);
    setShowOutlineState(restored === 'outline');
  }, [agentTabVisible, showAgent, currentFile, rootPath]);

  // 文件类型编辑器预热：由各贡献自行决定是否需要预热（见约定 preload(ctx)）
  useEffect(() => {
    if (isInitializing) return;
    for (const c of listFileEditors()) {
      c.preload?.({ isSingleFileMode, currentFile });
    }
  }, [isInitializing, isSingleFileMode, currentFile, fileEditor.contribution]);



  // 渲染期就解析出关闭后的目标 tab：否则 idle 与 effect 之间会先落到 files 再跳回。
  const closingTarget =
    showAgent && !agentTabVisible
      ? restoreTabAfterClose(tabBeforeAgentRef.current, {
          hasFile: !!currentFile,
          hasRoot: !!rootPath,
        })
      : null;

  const activeTab = resolveActiveTab({
    agentTabVisible,
    showAgent,
    closingTarget,
    showOutline,
    hasRoot: !!rootPath,
    isSingleFileMode,
  });

  // 大纲按需计算：大纲面板打开、侧栏大纲 tab **且未折叠**，或命令面板处于 `#` 模式；
  // 否则编辑器收不到回调，跳过全文序列化/摘要切片。
  // 用 activeTab 而不是 showOutline：单文件模式 / 无根目录时侧栏默认落在大纲 tab，
  // 此时 showOutline 仍为 false，只判断它会漏掉这个消费点。折叠时侧栏只是
  // width/opacity 归零、子树仍在 DOM，必须一并排除，否则专注写作时仍在白付序列化。
  const sidebarOutlineVisible = isSidebarOutlineVisible(activeTab, sidebar.collapsed);
  const outlineNeeded = shouldComputeOutline(outlineStyle, isOutlineMode, sidebarOutlineVisible);

  // 标题栏的文件信息卡片数据：全文走 getter（只在卡片展开时读取），
  // 因此这个对象在编辑期间身份不变，TitleBar 的 memo 才能在每键重渲染时生效。
  const fileInfo = useMemo(
    () => ({
      filePath: currentFile,
      isTemp: fileHandle.kind === 'temp',
      getContent: () => currentContentRef.current,
    }),
    [currentFile, fileHandle.kind, currentContentRef],
  );

  // 文件树是 memo 化的子树：这里的行内箭头函数会让每键重渲染的 memo 失效
  const handleCancelRenaming = useCallback(() => setRenamingPath(undefined), []);

  return (
    <div className={`app ${isMobileLayout ? 'mobile-layout' : ''}`}>
      {/* 移动端侧边栏遮罩层 */}
      {isMobileLayout && !sidebar.collapsed && (
        <div
          className="mobile-sidebar-overlay"
          onClick={() => sidebar.setCollapsed(true)}
        />
      )}

      <div className="main-content">
        {!isInitializing && (
          <Sidebar
            collapsed={sidebar.collapsed}
            position={sidebar.position}
            width={sidebar.width}
            isResizing={sidebar.isResizing}
            isMobileLayout={isMobileLayout}
            sidebarRef={sidebarRef}
            onToggleCollapsed={sidebar.toggleCollapsed}
            onResizeStart={sidebar.handleResizeStart}
          >
            <ContextMenuProvider>
              <ShortcutProvider>
                <div className="tree-header">
                  <div className="tree-tabs">
                    <div className="tree-tabs-group">
                      <button
                        className={`tree-tab ${activeTab === 'files' ? 'active' : ''}`}
                        onClick={() => setShowOutline(false)}
                        title={t('directoryTree.title')}
                        disabled={!rootPath}
                      >
                        <span>{t('directoryTree.title')}</span>
                      </button>
                      <button
                        className={`tree-tab ${activeTab === 'outline' ? 'active' : ''}`}
                        onClick={() => setShowOutline(true)}
                        title={t('outline.title')}
                        disabled={!currentFile}
                      >
                        <span>{t('outline.title')}</span>
                      </button>
                      {agentTabVisible && (
                        <button
                          className={`tree-tab ${activeTab === 'ai' ? 'active' : ''}`}
                          onClick={() => {
                            if (!showAgent) {
                              tabBeforeAgentRef.current = showOutline ? 'outline' : 'files';
                            }
                            setShowOutline(false);
                            setShowAgent(true);
                            void setAgentSurface('sidebar').catch(() => {});
                          }}
                          title={agentTabText}
                        >
                          <span>{agentTabText}</span>
                        </button>
                      )}
                    </div>
                  </div>
                  {activeTab === 'files' && !searchOpen && (
                    <button
                      className="file-tree-search-toggle"
                      onClick={handleToggleSearch}
                      title={t('directoryTree.search')}
                      aria-label={t('directoryTree.search')}
                    >
                      <Search size={14} />
                    </button>
                  )}
                  {searchOpen && (
                    <FileTreeSearch
                      query={searchQuery}
                      searching={isSearching}
                      placeholder={t('directoryTree.searchPlaceholder')}
                      onChange={setSearchQuery}
                      onClose={handleClearSearch}
                      closeTitle={t('common.close')}
                    />
                  )}
                </div>
                <div className="sidebar-tab-content">
                  <div className={`sidebar-tab-panel${activeTab === 'files' ? ' active' : ''}`}>
                    <div className="tree-panel-stack">
                      <FileTree
                        rootNode={files[0] ?? null}
                        currentFile={currentFile}
                        onFileSelect={handleFileSelect}
                        onFileClose={handleFileClose}
                        onCreateFile={handleCreateFile}
                        onCreateFolder={handleCreateFolder}
                        defaultRenamingPath={renamingPath}
                        onCancelRenaming={handleCancelRenaming}
                        onDeleteFiles={handleDeleteFiles}
                        onRenameFile={handleRenameFile}
                        onOpenInFinder={handleOpenInFinder}
                        rootPath={rootPath || undefined}
                        autoExpandToFile={sidebar.collapsed}
                        openableExtensions={effectiveOpenableExtensions}
                      />
                      {searchOpen && searchQuery.trim() && (
                        <div className="search-results-overlay">
                          <SearchResults
                            results={searchResults}
                            query={searchQuery}
                            rootPath={rootPath || ''}
                            currentFile={currentFile}
                            searching={isSearching}
                            limitReached={searchResults.length >= SEARCH_RESULT_LIMIT}
                            onFileSelect={handleFileSelect}
                            noResultsText={t('directoryTree.searchNoResults')}
                            limitReachedText={t('directoryTree.searchLimitReached')}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={`sidebar-tab-panel${activeTab === 'outline' ? ' active' : ''}`}>
                    {/* 侧栏大纲 tab 也是 outline 门控的消费点：调整 outlineNeeded 时不要漏掉它，
                        否则默认配置（outline_style = off）下这棵树会恒空。 */}
                    <OutlineTree
                      outline={outline}
                      onOutlineClick={handleOutlineClick}
                    />
                  </div>
                  <div className={`sidebar-tab-panel${activeTab === 'ai' ? ' active' : ''}`}>
                    {activeTab === 'ai' && (
                      <Suspense fallback={<div className="agent-panel-loading" />}>
                        <AgentPanel />
                      </Suspense>
                    )}
                  </div>
                </div>
              </ShortcutProvider>
            </ContextMenuProvider>
          </Sidebar>
        )}
        <div className={`editor-area${isFileEditorActive ? ' plugin-editor-active' : ''}`}>
          <TitleBar
            key={currentFile || 'empty'}
            title={currentTitle}
            isModified={isModified}
            isUnsavedFile={fileHandle.kind === 'temp'}
            hasExternalConflict={hasExternalConflict}
            isFileDeleted={currentFileDeleted && !!currentFile}
            onRecoverFile={handleRecoverDeletedFile}
            hasSidebar={!sidebar.collapsed}
            sidebarPosition={sidebar.position}
            editorMode={editorMode}
            onToggleEditorMode={toggleEditorMode}
            onToggleSidebar={sidebar.toggleCollapsed}
            isLocked={isLocked}
            onToggleLock={toggleLock}
            hasDocument={!!currentFile}
            isFileEditorActive={isFileEditorActive}
            fileInfo={fileInfo}
          />
          <div className="editor-container">
            {showFileEditorSlot && lastFileEditorRef.current && (
              <div className={`plugin-editor-slot${isFileEditorActive ? ' plugin-editor-slot-active' : ''}`}>
                <FileEditorHost
                  contribution={lastFileEditorRef.current.contribution}
                  fileEditorRef={fileEditor.ref}
                  host={hostFor(lastFileEditorRef.current.pluginId)}
                  filePath={isFileEditorActive ? currentFile : null}
                  isTemp={fileHandle.kind === 'temp'}
                  editable={!isLocked}
                  onModifiedChange={setIsModified}
                  onPathChange={handleFileEditorPathChange}
                />
              </div>
            )}
            {!isFileEditorActive && (
              <MarkdownEditor
                ref={editorRef}
                key={editorKey}
                content={currentContent}
                onChange={handleContentChange}
                onSave={handleSave}
                appearance={appearance}
                codeBlockWordWrap={codeBlockWordWrap}
                showLineNumbers={showLineNumbers}
                readableLineLength={readableLineLength}
                typewriterEnabled={typewriterEnabled}
                scrollToLine={scrollToLine}
                scrollToTrigger={scrollTrigger}
                scrollToHeading={scrollToHeading}
                onOutlineChange={outlineNeeded ? setOutline : undefined}
                editorMode={editorMode}
                positionKey={editorKey}
                documentPath={currentFile || undefined}
                isSingleFileMode={isSingleFileMode}
                openableExtensions={effectiveOpenableExtensions}
                onOpenFileLink={handleOpenFileLink}
                autoCapitalize={autoCapitalize}
                editable={!isLocked}
                onInsertEmbed={(embed) => insertEmbedReference(hostFor(HOST_PLUGIN_ID), embed)}
                extraPlugins={[toolbarStateController.plugin]}
                irHeader={
                  // 顶部格式操作栏是 IR 页的顶部：作为 IR pane 的子节点渲染，切换模式时随 IR 页一起平移。
                  // 结构性显隐由 pane 的 display 承担（SV 稳态下 IR pane 为 display:none），不再靠卸载。
                  <EditorToolbar
                    editorRef={editorRef}
                    visible={showEditorToolbar}
                    contextVisible={editorMode === 'ir'}
                    onCloseToolbar={handleCloseToolbar}
                    onExportPdf={handleExportPdf}
                    onExport={(id) => { void handleExport(id) }}
                    onExportPng={IS_MAC ? handleExportPng : undefined}
                    onPrint={IS_MAC ? handlePrint : undefined}
                    isSingleFileMode={isSingleFileMode}
                    pdfExportDisabled={fileHandle.kind === 'temp' || !fileEditor.exportable}
                    toolbarStateController={toolbarStateController}
                  />
                }
              />
            )}
            {!isFileEditorActive && (
              <WordCountBadge content={currentContent} enabled={showWordCount} />
            )}

            {!isMobileLayout && !isInitializing && outlineMounted && !isFileEditorActive && (
              <OutlinePanel
                width={outlinePanel.width}
                isResizing={outlinePanel.isResizing}
                closing={outlineClosing}
                outline={outline}
                outlineStyle={outlineStyle}
                activeIndex={activeOutlineIndex}
                documentKey={currentFile || 'empty'}
                onClose={() => changeOutlineStyle('off')}
                onOutlineClick={handleOutlineClick}
                onResizeStart={outlinePanel.handleResizeStart}
              />
            )}
          </div>
        </div>
      </div>
      <Toaster position="bottom-right" />

      {/* Command Palette */}
      <CommandDialog open={commandOpen} onOpenChange={(open) => {
        setCommandOpen(open);
        if (!open) setCommandInput('');
      }} className="top-[15%]">
        {/* 面板关闭时用 `&&` 短路，避免 App 每次重渲染（含每次按键）都重建
            全部命令项/大纲项/导出项——JSX 子节点在父组件 render 期求值。 */}
        {commandOpen && (
        <Command shouldFilter={!isOutlineMode}>
          <CommandInput
            placeholder={isOutlineMode ? t('command.searchOutlinePlaceholder') : t('command.searchPlaceholder')}
            onValueChange={setCommandInput}
          />
          <CommandList>
            <CommandEmpty>{t('command.noResults')}</CommandEmpty>

            {/* 大纲模式：只显示大纲标题 */}
            {isOutlineMode ? (
              <>
                {currentFile ? (
                  <CommandGroup heading={t('command.outline')}>
                    {filteredHeadings.length === 0 ? (
                      <CommandItem disabled>
                        <span className="text-muted-foreground">{t('command.noOutline')}</span>
                      </CommandItem>
                    ) : (
                      filteredHeadings.map((heading) => (
                        <CommandItem
                          key={heading.id}
                          onSelect={() => {
                            jumpToHeading(heading);
                            setCommandOpen(false);
                            setCommandInput('');
                          }}
                          className={heading.level >= 3 ? 'text-sm text-muted-foreground' : ''}
                        >
                          {heading.level === 1 && <Heading1 className="mr-2 h-4 w-4 shrink-0" />}
                          {heading.level === 2 && <Heading2 className="mr-2 h-4 w-4 shrink-0" />}
                          {heading.level >= 3 && <Heading3 className="mr-2 h-4 w-4 shrink-0" />}
                          <span className="truncate">
                            {(heading.displayText ?? heading.text) || t('command.emptyHeading')}
                          </span>
                        </CommandItem>
                      ))
                    )}
                  </CommandGroup>
                ) : (
                  <CommandGroup heading={t('command.outline')}>
                    <CommandItem disabled>
                      <span className="text-muted-foreground">{t('command.openFileFirst')}</span>
                    </CommandItem>
                  </CommandGroup>
                )}
              </>
            ) : (
              <>
                <CommandGroup heading={t('command.settings')}>
                  <CommandItem onSelect={() => { createSettingsWindow(); setCommandOpen(false); setCommandInput(''); }}>
                    <Settings className="mr-2 h-4 w-4" />
                    <span>{t('command.openSettings')}</span>
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading={t('command.file')}>
                  <CommandItem onSelect={() => { handleNewFile(); setCommandOpen(false); setCommandInput(''); }}>
                    <FilePlus className="mr-2 h-4 w-4" />
                    <span>{t('command.newFile')}</span>
                  </CommandItem>
                  <CommandItem onSelect={() => { handleOpenFile(); setCommandOpen(false); setCommandInput(''); }}>
                    <FileSearch className="mr-2 h-4 w-4" />
                    <span>{t('command.openFile')}</span>
                  </CommandItem>
                  <CommandItem onSelect={() => { handleOpenFolder(); setCommandOpen(false); setCommandInput(''); }}>
                    <Folder className="mr-2 h-4 w-4" />
                    <span>{t('command.openFolder')}</span>
                  </CommandItem>
                  <CommandItem onSelect={() => { handleSave(); setCommandOpen(false); setCommandInput(''); }}>
                    <FileText className="mr-2 h-4 w-4" />
                    <span>{t('command.saveFile')}</span>
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading={t('command.view')}>
                  <CommandItem onSelect={() => { sidebar.toggleCollapsed(); setCommandOpen(false); setCommandInput(''); }}>
                    <span>{t('command.toggleSidebar')}</span>
                  </CommandItem>
                  <CommandItem onSelect={() => { toggleEditorMode(); setCommandOpen(false); setCommandInput(''); }}>
                    <span>{t('command.toggleEditMode')}</span>
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading={t('command.insert')}>
                  <CommandItem disabled={isSingleFileMode} onSelect={() => {
                    setCommandOpen(false);
                    setCommandInput('');
                    setTimeout(() => {
                      editorRef.current?.insertImage();
                    }, 100);
                  }}>
                    <Image className="mr-2 h-4 w-4" />
                    <span>{t('command.insertImage')}</span>
                  </CommandItem>
                  {listEmbeds()
                    .filter((embed) => !!embed.insertLabelKey)
                    .map((embed) => (
                      <CommandItem
                        key={embed.id}
                        disabled={isSingleFileMode}
                        onSelect={() => {
                          setCommandOpen(false);
                          setCommandInput('');
                          void insertEmbedReference(hostFor(HOST_PLUGIN_ID), embed).catch((err) => {
                            console.error(`[plugins] insert embed failed: ${embed.id}`, err);
                          });
                        }}
                      >
                        <PenTool className="mr-2 h-4 w-4" />
                        <span>{t(embed.insertLabelKey!)}</span>
                      </CommandItem>
                    ))}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading={t('menu.export')}>
                  {listExporters().map((exporter) => (
                    <CommandItem
                      key={exporter.id}
                      onSelect={() => {
                        setCommandOpen(false);
                        setCommandInput('');
                        void handleExport(exporter.id);
                      }}
                    >
                      <span>{t(exporter.labelKey)}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
                {listCommandsWithOwner().length > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading={t('settings.plugins')}>
                      {listCommandsWithOwner().map(({ pluginId, command: cmd }) => (
                        <CommandItem
                          key={cmd.id}
                          disabled={cmd.enabled ? !cmd.enabled() : false}
                          onSelect={() => {
                            setCommandOpen(false);
                            setCommandInput('');
                            void Promise.resolve(cmd.run(hostFor(pluginId))).catch((err) => {
                              console.error(`[plugins] command failed: ${cmd.id}`, err);
                            });
                          }}
                        >
                          <span>{t(cmd.titleKey)}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}
              </>
            )}
          </CommandList>
        </Command>
        )}
      </CommandDialog>


    </div>
  );
}

export default App;
