-- A solo teacher proves their phone on the sign-up form itself, before any
-- account exists (the user, 2026-10-14: one window, nothing asked twice).
-- Its own migration: a value added by ALTER TYPE cannot be used in the same
-- transaction.
ALTER TYPE "PhoneVerificationPurpose" ADD VALUE 'SIGNUP';
