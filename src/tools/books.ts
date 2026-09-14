import { z } from "zod";
import { confirm, defineTool, id, percent, throwIf } from "./define.js";
import { ownedBook, resolveCategoryId } from "./ownership.js";
import type { ToolContext } from "../context.js";
import { computeBookStats } from "../domain/books.js";
import type { BookStatus, Tables } from "../domain/database.js";
import { getSettings } from "../services/settings.js";
import { awardXp, revokeXp } from "../services/xp-award.js";

const BOOK_STATUSES = ["to_read", "reading", "completed", "abandoned"] as const satisfies readonly BookStatus[];

const bookFields = {
  title: z.string().trim().min(1).max(300),
  author: z.string().max(200),
  pages: z.number().int().min(0).max(100000),
  current_page: z.number().int().min(0).max(100000),
  status: z.enum(BOOK_STATUSES).describe("to_read | reading | completed | abandoned"),
  category_id: id("Category").nullable().describe("Category id, or null for none"),
  notes: z.string().max(50000),
  rating: z.number().int().min(1).max(5).nullable().describe("1-5, or null to clear"),
};

type BookChanges = Partial<{
  title: string;
  author: string;
  pages: number;
  current_page: number;
  status: BookStatus;
  category_id: string | null;
  notes: string;
  rating: number | null;
}>;

function presentBook(book: Tables<"books">, categoryName?: string | null) {
  return {
    ...book,
    category: categoryName ?? undefined,
    progress_percent: book.pages > 0 ? percent(Math.min(1, book.current_page / book.pages)) : null,
  };
}

/**
 * Same rules as the app's updateBook: started_at is set the first time the book
 * leaves to_read, completed_at follows the status, and reaching `completed` grants
 * the book-completion XP once (leaving it revokes that XP).
 */
async function applyBookChanges(ctx: ToolContext, existing: Tables<"books">, changes: BookChanges) {
  const status = changes.status ?? existing.status;
  const becameCompleted = status === "completed" && existing.status !== "completed";
  const unbecameCompleted = status !== "completed" && existing.status === "completed";
  const now = new Date().toISOString();

  const categoryId = await resolveCategoryId(ctx, changes.category_id);

  const { data, error } = await ctx.supabase
    .from("books")
    .update({
      title: changes.title ?? existing.title,
      author: changes.author ?? existing.author,
      pages: changes.pages ?? existing.pages,
      current_page: changes.current_page ?? existing.current_page,
      status,
      category_id: categoryId === undefined ? existing.category_id : categoryId,
      notes: changes.notes ?? existing.notes,
      rating: changes.rating === undefined ? existing.rating : changes.rating,
      started_at: existing.started_at ?? (status !== "to_read" ? now : null),
      completed_at: becameCompleted ? now : unbecameCompleted ? null : existing.completed_at,
    })
    .eq("id", existing.id)
    .eq("user_id", ctx.userId)
    .select()
    .single();
  throwIf(error);

  let xp = 0;
  if (becameCompleted) {
    const settings = await getSettings(ctx.supabase, ctx.userId);
    await awardXp(ctx.supabase, ctx.userId, "book", existing.id, settings.book_completion_xp);
    xp = settings.book_completion_xp;
  } else if (unbecameCompleted) {
    await revokeXp(ctx.supabase, ctx.userId, "book", existing.id);
    xp = -1;
  }
  return { book: data!, xp_awarded: xp > 0 ? xp : 0, xp_revoked: xp < 0 };
}

export const bookTools = [
  defineTool({
    name: "list_books",
    title: "List books",
    description:
      "Liste la bibliotheque avec progression de lecture, filtrable par statut, categorie ou texte, " +
      "plus un resume (livres termines, pages lues, vitesse de lecture en pages/jour).",
    kind: "read",
    input: {
      status: z.enum(BOOK_STATUSES).optional(),
      category_id: id("Category").optional(),
      query: z.string().max(200).optional().describe("Matches title, author or notes"),
    },
    handler: async ({ status, category_id, query }, { supabase, userId }) => {
      const { data, error } = await supabase
        .from("books")
        .select("*, categories ( name )")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      throwIf(error);

      type Row = Tables<"books"> & { categories: { name: string } | null };
      const all = (data ?? []) as unknown as Row[];
      const needle = query?.toLocaleLowerCase("fr");
      const books = all.filter(
        (book) =>
          (!status || book.status === status) &&
          (!category_id || book.category_id === category_id) &&
          (!needle || [book.title, book.author, book.notes].some((v) => v.toLocaleLowerCase("fr").includes(needle))),
      );
      const stats = computeBookStats(all);

      return {
        summary: {
          total: all.length,
          completed: stats.completed,
          pages_read: stats.pagesRead,
          reading_speed_pages_per_day: stats.readingSpeed,
        },
        books: books.map(({ categories, ...book }) => presentBook(book, categories?.name ?? null)),
      };
    },
  }),

  defineTool({
    name: "get_book",
    title: "Get book",
    description: "Detail d'un livre (notes completes, note, dates, progression).",
    kind: "read",
    input: { book_id: id("Book") },
    handler: async ({ book_id }, ctx) => presentBook(await ownedBook(ctx, book_id)),
  }),

  defineTool({
    name: "create_book",
    title: "Create book",
    description:
      "Ajoute un livre. Par defaut statut to_read ; un statut completed accorde tout de suite l'XP de fin de livre.",
    kind: "write",
    input: {
      title: bookFields.title,
      author: bookFields.author.optional(),
      pages: bookFields.pages.optional(),
      current_page: bookFields.current_page.optional(),
      status: bookFields.status.optional(),
      category_id: bookFields.category_id.optional(),
      notes: bookFields.notes.optional(),
      rating: bookFields.rating.optional(),
    },
    handler: async ({ title, author, pages, category_id, ...rest }, ctx) => {
      const categoryId = await resolveCategoryId(ctx, category_id);
      const { data, error } = await ctx.supabase
        .from("books")
        .insert({
          user_id: ctx.userId,
          title,
          author: author ?? "",
          pages: pages ?? 0,
          category_id: categoryId ?? null,
          status: "to_read",
        })
        .select()
        .single();
      throwIf(error);

      const hasMore = Object.values(rest).some((value) => value !== undefined);
      if (!hasMore) return { created: presentBook(data!) };
      const result = await applyBookChanges(ctx, data!, rest);
      return { created: presentBook(result.book), xp_awarded: result.xp_awarded };
    },
  }),

  defineTool({
    name: "update_book",
    title: "Update book",
    description:
      "Modifie un livre (seuls les champs fournis changent). Passer a completed accorde l'XP de fin de livre une fois ; " +
      "quitter completed la retire. category_id/rating a null les effacent.",
    kind: "write",
    input: {
      book_id: id("Book"),
      title: bookFields.title.optional(),
      author: bookFields.author.optional(),
      pages: bookFields.pages.optional(),
      current_page: bookFields.current_page.optional(),
      status: bookFields.status.optional(),
      category_id: bookFields.category_id.optional(),
      notes: bookFields.notes.optional(),
      rating: bookFields.rating.optional(),
    },
    handler: async ({ book_id, ...changes }, ctx) => {
      const existing = await ownedBook(ctx, book_id);
      const result = await applyBookChanges(ctx, existing, changes);
      return { updated: presentBook(result.book), xp_awarded: result.xp_awarded, xp_revoked: result.xp_revoked };
    },
  }),

  defineTool({
    name: "update_book_progress",
    title: "Update reading progress",
    description:
      "Enregistre la page actuelle (bornee au nombre de pages). Un livre to_read passe automatiquement a reading.",
    kind: "write",
    input: { book_id: id("Book"), current_page: bookFields.current_page },
    handler: async ({ book_id, current_page }, ctx) => {
      const existing = await ownedBook(ctx, book_id);
      const clamped = Math.max(0, Math.min(current_page, existing.pages || current_page));
      const { data, error } = await ctx.supabase
        .from("books")
        .update({
          current_page: clamped,
          status: existing.status === "to_read" ? "reading" : existing.status,
          started_at: existing.started_at ?? new Date().toISOString(),
        })
        .eq("id", book_id)
        .eq("user_id", ctx.userId)
        .select()
        .single();
      throwIf(error);
      return { updated: presentBook(data!) };
    },
  }),

  defineTool({
    name: "delete_book",
    title: "Delete book",
    description: "Supprime DEFINITIVEMENT un livre (et l'XP de fin de livre qu'il avait rapportee).",
    kind: "delete",
    input: { book_id: id("Book"), confirm },
    handler: async ({ book_id }, ctx) => {
      const book = await ownedBook(ctx, book_id);
      await revokeXp(ctx.supabase, ctx.userId, "book", book_id);
      const { error } = await ctx.supabase.from("books").delete().eq("id", book_id).eq("user_id", ctx.userId);
      throwIf(error);
      return { deleted: { id: book.id, title: book.title } };
    },
  }),
];
