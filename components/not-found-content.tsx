import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Home, ArrowLeft } from 'lucide-react';

interface NotFoundContentProps {
  title?: string;
  description?: string;
  backLink: string;
  backLabel: string;
  showHomeLink?: boolean;
}

export function NotFoundContent({
  title = 'Page Not Found',
  description = "The page you're looking for doesn't exist or has been moved.",
  backLink,
  backLabel,
  showHomeLink = false,
}: NotFoundContentProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] p-4">
      <div className="glass-card w-full max-w-lg rounded-2xl p-12 text-center">
        <h1 className="text-foreground mb-4 text-3xl font-bold">{title}</h1>

        <p className="text-muted-foreground mb-8 leading-relaxed">{description}</p>

        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="px-8">
            <Link href={backLink} className="flex items-center justify-center gap-2">
              <ArrowLeft className="h-5 w-5" />
              {backLabel}
            </Link>
          </Button>

          {showHomeLink && (
            <Button asChild size="lg" variant="outline" className="px-8">
              <Link href="/welcome" className="flex items-center justify-center gap-2">
                <Home className="h-5 w-5" />
                Home
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
