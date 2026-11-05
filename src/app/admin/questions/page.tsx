import type { Metadata } from "next";
import { QuestionBuilder } from "@/components/admin/QuestionBuilder";

export const metadata: Metadata = {
  title: "Question Builder · Plákata admin",
  robots: { index: false, follow: false },
};

/**
 * The admin Question Builder. The page itself holds no data: it signs in through
 * /api/admin/session, and every admin API checks the server-side session.
 */
export default function AdminQuestionsPage() {
  return <QuestionBuilder />;
}
