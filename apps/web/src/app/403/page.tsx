export default function ForbiddenPage() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="text-xs uppercase tracking-wider text-amber-500 mb-2">403</div>
        <h1 className="text-2xl font-semibold tracking-tight">You don't have access</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Your role doesn't permit viewing this page. If you think that's wrong,
          ask your workspace owner or manager.
        </p>
      </div>
    </main>
  );
}
