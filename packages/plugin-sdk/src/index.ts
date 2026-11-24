export type {
  AgentAnchorRect,
  AgentCapability,
  AgentEvent,
  AgentHandlers,
  AgentMessageInput,
  AgentPresentOptions,
  AgentPresentSize,
  AgentProfileInfo,
  AgentRequest,
  AgentRunHandle,
  AgentRunOptions,
  AgentToolInfo,
  AgentToolResult,
  Appearance,
  CommandCategory,
  CommandContribution,
  Contributes,
  Edition,
  ExporterContribution,
  ExtensionPointMap,
  ExtensionPointSpec,
  FileEditorContribution,
  FileEditorHandle,
  FileEditorProps,
  FileFilter,
  PluginHost,
  PluginLocale,
  PluginMigration,
  SelectionContextSnapshot,
  TextoPlugin,
} from './types';
export type { IconDef, IconElement, IconSpec } from './icon';
export { definePlugin } from './define-plugin';
export { collectDeclaredI18nKeys } from './plugin-i18n';
export {
  declareExtensionPoint,
  getContributions,
  getContributionsWithOwner,
  hasExtensionPoint,
  ownerOfExtensionPoint,
  registerContributions,
  resetExtensionPointsForTests,
  subscribeContributions,
  unregisterContribution,
  unregisterOwner,
} from './extension-points';
export { isKnownCategory, isOfficialPlugin, OFFICIAL_AUTHOR, PLUGIN_CATEGORIES } from './meta';
export type { PluginCategory } from './meta';
export {
  getPluginConfigSnapshot,
  resetPluginConfigSnapshotsForTests,
  setPluginConfigSnapshot,
  subscribePluginConfig,
} from './plugin-config-snapshot';
export * from './app';
export * from './editor';
export * from './settings-defaults';
