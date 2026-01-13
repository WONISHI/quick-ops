export interface ISnippetItem {
    prefix: string;
    body: string[];
    description?: string;
    scope?: string[]; // e.g., ["vue", "vue2", "react"]
    style?: string;   // markdown 代码块的语言，如 'vue', 'html'
}