import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none prose-headings:font-display prose-headings:text-foreground prose-p:leading-relaxed prose-a:text-primary prose-strong:text-foreground prose-code:rounded prose-code:bg-secondary prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:font-normal prose-code:before:content-none prose-code:after:content-none prose-pre:bg-secondary prose-pre:text-foreground prose-blockquote:border-primary/40 prose-blockquote:text-muted-foreground prose-th:text-foreground prose-td:text-foreground/90">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
