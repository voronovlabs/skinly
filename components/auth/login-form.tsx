"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, Input } from "@/components/ui";
import { loginAction } from "@/app/actions/auth";
import {
  INITIAL_AUTH_STATE,
  type AuthFormState,
} from "@/lib/auth/forms";

export function LoginForm() {
  const t = useTranslations("auth.login");
  const tErr = useTranslations("auth.login.errors");

  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    loginAction,
    INITIAL_AUTH_STATE,
  );

  return (
    <form action={action} className="space-y-4" noValidate>
      <Field label={t("email")} htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder={t("emailPlaceholder")}
          defaultValue={state?.email ?? ""}
        />
      </Field>

      <Field label={t("password")} htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
        />
      </Field>

      {state?.error && (
        <p
          role="alert"
          className="rounded-md bg-error-blush px-3 py-2 text-body-sm text-error-deep"
        >
          {tErr(state.error)}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>

      <p className="text-center text-body-sm text-muted-graphite pt-2">
        {t("noAccount")}{" "}
        <Link
          href="/register"
          className="font-medium text-lavender-deep hover:underline"
        >
          {t("registerLink")}
        </Link>
      </p>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-body-sm font-medium text-graphite"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
