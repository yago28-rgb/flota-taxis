"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertUser } from "@/lib/auth/session";
import { setSetting } from "@/lib/settings";
import { normalizeTaxId } from "@/lib/format";
import { str, toActionError, type ActionState } from "./util";

export async function saveBusinessSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await assertUser("admin");
    await setSetting("owner", { name: str(fd, "ownerName"), taxId: normalizeTaxId(str(fd, "ownerTaxId")) }, user.id);
    await setSetting(
      "accounting",
      { movementAmountBasis: z.enum(["net", "gross"]).parse(str(fd, "movementAmountBasis") ?? "net"), confirmedByUser: true },
      user.id,
    );
    await setSetting(
      "extraction",
      {
        extraInstructions: z.string().max(4000).nullable().parse(str(fd, "extraInstructions")),
        lowConfidenceThreshold: z.coerce.number().min(0.3).max(0.99).parse(str(fd, "lowConfidenceThreshold") ?? "0.75"),
      },
      user.id,
    );
    await setSetting("businessRules", { notes: z.string().max(10000).nullable().parse(str(fd, "businessNotes")) }, user.id);
    revalidatePath("/ajustes");
    return { ok: true, message: "Ajustes guardados." };
  } catch (e) {
    return toActionError(e);
  }
}
