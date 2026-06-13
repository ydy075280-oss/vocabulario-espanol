export default function Loading({ full = false }: { full?: boolean }) {
  if (full) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-canvas z-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-hairline border-t-brand rounded-full animate-spin" />
          <p className="text-typo-secondary text-sm">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-8 h-8 border-2 border-hairline border-t-brand rounded-full animate-spin" />
    </div>
  );
}
