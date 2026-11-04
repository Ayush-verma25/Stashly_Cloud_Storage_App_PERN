import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Input } from "../components/ui/Input";
import { LockIcon, MailIcon, UserIcon } from "lucide-react";
import { Button } from "../components/ui/Button";
import { useApp } from "../context/AppContext";

const Login = ({ mode = "login" }) => {
  const isRegister = mode === "register";
  const navigate = useNavigate();
  const { login, register } = useApp();

  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [isLoading, setIsLoading] = useState(false);

  const updateField = (key, value) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    const ok = isRegister
      ? await register(form.name, form.email, form.password)
      : await login(form.email, form.password);
    setIsLoading(false);
    if (ok) navigate("/");
  };

  return (
    <div className="flex min-h-screen flex-col bg-white text-zinc-900 md:flex-row">
      {/* Left Hero Section */}
      <div className="relative flex min-h-screen flex-col justify-between overflow-hidden border-b border-zinc-200 bg-linear-to-br from-green-50 via-zinc-50 to-blue-50 px-6 py-8 sm:px-10 md:w-1/2 md:border-b-0 md:border-r md:px-12 md:py-12 lg:px-16 lg:py-14">
        <div
          className="absolute inset-0 bg-[url('/pattern.svg')]"
          aria-hidden="true"
        ></div>

        <div className="relative z-10 flex items-center">
          <img
            src="/stashly-logo.svg"
            alt="Stashly"
            className="block h-auto w-48 max-w-full object-contain object-left sm:w-56 md:w-60 lg:w-64"
          />
        </div>

        <div className="relative z-10 mt-auto max-w-xl space-y-5 pb-8 pt-24 md:pb-12 md:pt-0">
          <h2 className="text-[clamp(1.125rem,2.2vw,3.5rem)] font-semibold leading-[1.08] tracking-tight text-zinc-900">
            <span className="whitespace-nowrap">Secure, simple, and fast</span>
            <span className="mt-2 block text-green-700">Cloud storage.</span>
          </h2>

          <p className="max-w-lg text-base leading-7 text-zinc-600 sm:text-lg sm:leading-8">
            Store, sync, and share your files with confidence. Keep everything
            protected with secure access controls and automatic backups.
          </p>
        </div>

        <div className="relative z-10 mt-8 text-xs tracking-wide text-zinc-500 sm:text-sm">
          © 2026 Stashly Cloud Services. All Rights Reserved.
        </div>
      </div>

      {/* Right Hero Section */}
      <div className="md:w-1/2 p-8 md:p-12 lg:p-16 flex items-center justify-center bg-white">
        <div className="w-full max-w-md space-y-6 animate-fade-in">
          <div>
            <h3 className="text-2xl font-medium text-zinc-900">
              {isRegister ? "Create an Account" : "Welcome back"}
            </h3>
            <p className="text-sm text-zinc-900 mt-1">
              {isRegister
                ? "Enter your Details below to get started with 1 GB free storage"
                : "Enter your credentials to access your Drive"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <Input
                label="Full Name"
                icon={UserIcon}
                placeholder="John Deo"
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                required
              />
            )}
            <Input
              label="Email Address"
              type="email"
              icon={MailIcon}
              placeholder="you@example.com"
              value={form.email}
              onChange={(e) => updateField("email", e.target.value)}
              required
            />

            <Input
              label="Password"
              type="password"
              icon={LockIcon}
              placeholder="●●●●●●●●"
              value={form.password}
              onChange={(e) => updateField("password", e.target.value)}
              required
            />

            <Button
              type="submit"
              variant="primary"
              className="w-full py-3"
              isLoading={isLoading}
            >
              <span className="font-medium text-base">
                {isRegister ? "Register Account" : "Sign In"}
              </span>
            </Button>
          </form>

          <div className="text-center pt-2">
            {isRegister ? (
              <p className="text-xs text-zinc-500">
                Already have a Account?{" "}
                <Link
                  to="/login"
                  className="text-green-600 font-semibold hover:underline"
                >
                  Sign In here
                </Link>
              </p>
            ) : (
              <p className="text-xs text-zinc-500">
                Don't have an Account Yet?{" "}
                <Link
                  to="/register"
                  className="text-green-600 font-semibold hover:underline"
                >
                  Create Account
                </Link>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
