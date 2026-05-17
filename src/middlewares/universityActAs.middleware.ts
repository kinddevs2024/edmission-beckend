import type { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { User } from "../models";
import { AppError, ErrorCodes } from "../utils/errors";
import type { Role } from "../types/role";
import { resolveActAsUniversityUserId } from "../services/universityIdentity.service";

const HEADER = "x-act-as-university";

/**
 * Lets delegated university roles call university APIs by sending
 * `X-Act-As-University: <university user id | university profile id | catalog id>`.
 * Rewrites `req.user.id` / `req.user.role` to the target university for downstream handlers.
 * Real delegate id is stored on `req.universityDelegation`.
 */
async function resolveUniversityActAsInternal(
  req: Request,
  _res: Response,
  next: NextFunction,
  requireHeader: boolean,
): Promise<void> {
  try {
    if (!req.user) {
      next();
      return;
    }
    if (req.user.role === "university") {
      next();
      return;
    }
    if (
      req.user.role !== "university_multi_manager" &&
      req.user.role !== "multi_university_admin"
    ) {
      next();
      return;
    }

    const raw =
      req.get(HEADER) ??
      (typeof req.headers[HEADER] === "string" ? req.headers[HEADER] : "");
    const actAs = String(raw ?? "").trim();
    if (!actAs && !requireHeader) {
      next();
      return;
    }
    if (!mongoose.Types.ObjectId.isValid(actAs)) {
      next(
        new AppError(
          400,
          "Valid X-Act-As-University header is required",
          ErrorCodes.VALIDATION,
        ),
      );
      return;
    }

    const delegate = await User.findById(req.user.id)
      .select("managedUniversityUserIds universityMultiManagerApproved role")
      .lean();
    if (
      !delegate ||
      !["university_multi_manager", "multi_university_admin"].includes(
        String((delegate as { role?: string }).role ?? ""),
      )
    ) {
      next(new AppError(403, "Insufficient permissions", ErrorCodes.FORBIDDEN));
      return;
    }
    const delegateRole = String((delegate as { role?: string }).role ?? "");
    if (
      delegateRole === "university_multi_manager" &&
      !(delegate as { universityMultiManagerApproved?: boolean })
        .universityMultiManagerApproved
    ) {
      next(
        new AppError(
          403,
          "Multi-university manager is not approved by an administrator",
          ErrorCodes.FORBIDDEN,
        ),
      );
      return;
    }

    const resolvedUniversityUserId = await resolveActAsUniversityUserId(actAs);
    if (!resolvedUniversityUserId) {
      next(new AppError(404, "University not found", ErrorCodes.NOT_FOUND));
      return;
    }
    if (delegateRole === "university_multi_manager") {
      const assignedRawIds = (
        (delegate as { managedUniversityUserIds?: unknown[] })
          .managedUniversityUserIds ?? []
      )
        .map((id) => String(id).trim())
        .filter((id) => mongoose.Types.ObjectId.isValid(id));
      const assignedUserIds = new Set<string>();
      for (const assignedId of assignedRawIds) {
        const assignedUserId = await resolveActAsUniversityUserId(assignedId);
        if (assignedUserId) assignedUserIds.add(assignedUserId);
      }
      if (!assignedUserIds.has(resolvedUniversityUserId)) {
        next(
          new AppError(
            403,
            "This university is not assigned to the multi-university manager",
            ErrorCodes.FORBIDDEN,
          ),
        );
        return;
      }
    }

    const managerUserId = req.user.id;
    req.universityDelegation = { managerUserId };
    Object.assign(req.user, {
      id: resolvedUniversityUserId,
      role: "university" as Role,
    });
    next();
  } catch (e) {
    next(e);
  }
}

export async function resolveUniversityActAs(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  return resolveUniversityActAsInternal(req, res, next, true);
}

export async function resolveUniversityActAsIfPresent(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  return resolveUniversityActAsInternal(req, res, next, false);
}
