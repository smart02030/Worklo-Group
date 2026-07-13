export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background grid-bg flex min-h-screen items-center justify-center p-4">
      {children}
    </div>
  );
}
