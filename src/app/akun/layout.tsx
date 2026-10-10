import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getRequestContext } from "@/server/context";
import { requireUser } from "@/server/context";
import { AccountTabs } from "@/components/account/account-tabs";

/** Halaman akun memerlukan sesi; tanpa JS tab tetap berupa tautan biasa. */
export default async function AccountLayout({ children }: { children: ReactNode }) {
  const ctx = await getRequestContext();
  if (!ctx.user) redirect("/masuk?setelah=/akun/pesanan");
  const user = requireUser(ctx);
  return (
    <div className="page section">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] leading-[32px]">Akun saya</h1>
          <p className="mt-1 text-[14px] text-secondary">
            {user.fullName} · {user.email}
            {user.roles.length > 0 ? (
              <span className="ml-2 text-[12px]">role: {user.roles.join(", ")}</span>
            ) : null}
          </p>
        </div>
      </div>
      <AccountTabs />
      <div className="mt-6">{children}</div>
    </div>
  );
}
