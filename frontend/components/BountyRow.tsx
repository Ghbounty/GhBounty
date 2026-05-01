"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { Avatar } from "./Avatar";
import { StatusBadge } from "./StatusBadge";
import { UsdcIcon } from "./UsdcIcon";
import type { Bounty, Company } from "@/lib/types";

export function BountyRow({
  bounty,
  company,
  showCompany = false,
  meta,
  action,
}: {
  bounty: Bounty;
  company?: Company;
  showCompany?: boolean;
  meta?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="bounty-card">
      <div className="bounty-card-head">
        {showCompany && company && (
          <Link
            href={`/app/companies/${encodeURIComponent(company.id)}`}
            className="bounty-company"
          >
            <Avatar
              src={company.avatarUrl}
              name={company.name}
              size={28}
              rounded={false}
            />
            <span className="bounty-company-name">{company.name}</span>
          </Link>
        )}
        <div className="bounty-card-head-right">
          {meta}
          {bounty.submissionCount !== undefined && bounty.submissionCount > 0 && (
            <span
              className="submission-count-pill"
              title={`${bounty.submissionCount} PR${bounty.submissionCount === 1 ? "" : "s"} submitted`}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <circle cx="6" cy="6" r="3" />
                <circle cx="18" cy="18" r="3" />
                <path d="M6 9v6a6 6 0 006 6h3" />
              </svg>
              {bounty.submissionCount} PR{bounty.submissionCount === 1 ? "" : "s"}
            </span>
          )}
          <StatusBadge status={bounty.status} />
        </div>
      </div>
      <a
        href={bounty.issueUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="bounty-card-title"
      >
        <span className="bounty-repo">
          {bounty.repo} <span className="bounty-hash">#{bounty.issueNumber}</span>
        </span>
        {bounty.title && <span className="bounty-issue-title">{bounty.title}</span>}
      </a>
      <div className="bounty-card-foot">
        <div className="bounty-amount">
          <span className="bounty-amount-val">{bounty.amountUsdc.toLocaleString()}</span>
          <span className="musdc-pill">
            SOL
          </span>
        </div>
        {action}
      </div>
    </div>
  );
}
