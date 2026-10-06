export type ChatSource = { title: string; url: string };
export type ChatEvent =
  | { event: 'content'; data: { text: string } }
  | { event: 'sources'; data: { sources: ChatSource[]; searchEntryPoint?: string } }
  | { event: 'done'; data: { truncated: boolean } }
  | { event: 'error'; data: { code: string; message: string } };
