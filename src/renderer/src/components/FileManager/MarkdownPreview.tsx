import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownPreviewProps {
  content: string;
}

const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ content }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || '*Empty file*'}</ReactMarkdown>
);

export default MarkdownPreview;
