"use client";

import { Suspense, useEffect } from "react";
import AuthShell from "@/features/auth/components/AuthShell";
import LoginForm from "@/features/auth/components/LoginForm";
import { useLogin } from "@/features/auth/hooks/useLogin";
import { markStartupContentReady } from "@/utils/startupGate";

function LoginPageContent() {
  const loginState = useLogin();
  const { mounted } = loginState;

  // First-screen content signal for the brand opener (see utils/startupGate).
  // A cold start with no session lands here, and the opener holds until this
  // fires. Nothing here waits on the network, so this is "the form is painted".
  useEffect(() => {
    if (mounted) markStartupContentReady();
  }, [mounted]);

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your trading journal.">
      <LoginForm {...loginState} />
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageContent />
    </Suspense>
  );
}
