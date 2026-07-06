export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 shadow-sm">
        {children}
      </div>
    </div>
  );
}
