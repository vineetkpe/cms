declare module '@toast-ui/editor' {
  export type ImageBlobCallback = (url: string, altText?: string) => void;

  export type EditorOptions = {
    el: HTMLElement;
    height?: string;
    initialEditType?: 'markdown' | 'wysiwyg';
    previewStyle?: 'tab' | 'vertical';
    usageStatistics?: boolean;
    hideModeSwitch?: boolean;
    toolbarItems?: unknown[];
    hooks?: {
      addImageBlobHook?: (blob: Blob, callback: ImageBlobCallback) => void | Promise<void>;
    };
  };

  export default class Editor {
    constructor(options: EditorOptions);
    getMarkdown(): string;
    setMarkdown(markdown: string, cursorToEnd?: boolean): void;
    on(event: string, handler: () => void): void;
  }
}
