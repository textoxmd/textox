declare module 'markdown-it-task-lists' {
  import { PluginSimple } from 'markdown-it';
  
  interface TaskListsOptions {
    enabled?: boolean;
    label?: boolean;
    labelAfter?: boolean;
  }
  
  const taskLists: PluginSimple<TaskListsOptions>;
  export default taskLists;
}
