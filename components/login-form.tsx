'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { signInWithEmail, signUpWithEmail } from '@/lib/auth';

interface LoginFormProps extends React.ComponentProps<'div'> {
  mode?: 'login' | 'signup';
}

export function LoginForm({ className, mode = 'login', ...props }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isSignUp, setIsSignUp] = useState(mode === 'signup');

  const _router = useRouter();
  const searchParams = useSearchParams();
  const rawRedirect = searchParams.get('redirectTo') ?? '/';
  const redirectTo =
    rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setMessage('');

    try {
      if (isSignUp) {
        const result = await signUpWithEmail(email, password, name);
        if (result.user) {
          if ('needsEmailConfirmation' in result && result.needsEmailConfirmation) {
            setMessage('Account created! Check your email to verify before logging in.');
          } else {
            setMessage('Account created successfully! Redirecting...');
            setTimeout(() => {
              window.location.href = redirectTo;
            }, 1500);
          }
        }
      } else {
        const { user } = await signInWithEmail(email, password);
        if (user) {
          setMessage('Login successful! Redirecting...');
          setTimeout(() => {
            window.location.href = redirectTo;
          }, 1500);
        }
      }
    } catch (error: unknown) {
      let errorMessage = 'An error occurred. Please try again.';
      const err = error as { message?: string };

      if (err.message?.includes('Supabase not configured')) {
        errorMessage =
          'Database not connected. Check your .env.local and ensure Supabase is running.';
      } else if (
        err.message?.includes('fetch') ||
        err.message?.includes('network') ||
        err.message?.includes('Failed to fetch')
      ) {
        errorMessage = 'Cannot reach the database. Check your Supabase URL and keys in .env.local.';
      } else if (
        err.message?.includes('User already registered') ||
        err.message?.includes('already been registered')
      ) {
        errorMessage = 'Email already in use. Try logging in instead.';
      } else if (err.message?.includes('Invalid login credentials')) {
        errorMessage = 'Invalid email or password.';
      } else if (err.message?.includes('Email not confirmed')) {
        errorMessage = 'Please confirm your email before logging in.';
      } else if (err.message?.includes('Password should be at least')) {
        errorMessage = 'Password must be at least 6 characters.';
      } else if (err.message?.includes('Invalid email')) {
        errorMessage = 'Please enter a valid email address.';
      } else if (err.message) {
        errorMessage = err.message;
      }

      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn('flex flex-col gap-0', className)} {...props}>
      {/* Logo / Brand */}
      <div className="mb-1 text-center">
        <div className="mb-2 inline-flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.gif" alt="Worklo" className="h-36 w-auto object-contain" />
        </div>
        <h1 className="text-foreground text-2xl font-bold">
          {isSignUp ? 'Create your account' : 'Welcome back'}
        </h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          {isSignUp ? 'Enter your details to get started' : 'Sign in to your workspace'}
        </p>
      </div>

      {/* Form card */}
      <div className="glass-card rounded-xl p-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {isSignUp && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="name" className="text-foreground text-[13px] font-medium">
                Full Name
              </label>
              <Input
                id="name"
                type="text"
                placeholder="John Doe"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                required
                disabled={isLoading}
                className="bg-card/5 text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:ring-primary/20 border-white/10"
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-foreground text-[13px] font-medium">
              Email
            </label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              required
              disabled={isLoading}
              className="bg-card/5 text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:ring-primary/20 border-white/10"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="text-foreground text-[13px] font-medium">
                Password
              </label>
              {!isSignUp && (
                <a
                  href="/forgot-password"
                  className="text-primary hover:text-primary/80 text-[12px] transition-colors"
                >
                  Forgot password?
                </a>
              )}
            </div>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
              required
              disabled={isLoading}
              className="bg-card/5 text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:ring-primary/20 border-white/10"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-[13px] text-red-400">
              {error}
            </div>
          )}

          {message && (
            <div className="text-primary bg-primary/10 border-primary/20 rounded-lg border px-3 py-2.5 text-[13px]">
              {message}
            </div>
          )}

          <Button type="submit" disabled={isLoading} className="mt-1 h-10 w-full">
            {isLoading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
          </Button>

          <p className="text-muted-foreground text-center text-[13px]">
            {isSignUp ? (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(false);
                  }}
                  className="text-primary hover:text-primary/80 font-medium transition-colors"
                  disabled={isLoading}
                >
                  Sign in
                </button>
              </>
            ) : (
              <>
                Don&apos;t have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(true);
                  }}
                  className="text-primary hover:text-primary/80 font-medium transition-colors"
                  disabled={isLoading}
                >
                  Sign up
                </button>
              </>
            )}
          </p>
        </form>
      </div>
    </div>
  );
}
