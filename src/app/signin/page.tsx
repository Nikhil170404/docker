import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import SignInForm from "@/components/auth/SignInForm";
import { isAuthConfigured } from "@/lib/auth/supabase";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to DocKaro to sync your documents and manage your plan.",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <>
      <Navbar />
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-2 text-sm text-muted">
            Your documents follow your account, on any device.
          </p>
          <div className="mt-8">
            <SignInForm configured={isAuthConfigured()} />
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
