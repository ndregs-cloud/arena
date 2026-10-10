import type { Metadata } from "next";
import { PolicyPage } from "@/components/commerce/policy-page";

export const metadata: Metadata = {
  title: "Syarat & Ketentuan",
  alternates: { canonical: "/syarat" },
};

export default function TermsPage() {
  return <PolicyPage policyKey="syarat" />;
}
