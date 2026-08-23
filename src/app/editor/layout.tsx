export default function EditorLayout({ children }: LayoutProps<"/editor">) {
  return <div className="fixed inset-0 flex flex-col bg-background">{children}</div>;
}
