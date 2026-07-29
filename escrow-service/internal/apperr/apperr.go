// Package apperr defines the single error shape used across the service:
// a stable code, a message safe to return, and an HTTP status. Internal causes
// are wrapped but never serialised — they go to the logs, keyed by request ID.
package apperr

import (
	"errors"
	"fmt"
	"net/http"
)

// Code is a stable identifier clients may branch on.
type Code string

const (
	CodeInvalidInput      Code = "INVALID_INPUT"
	CodeNotFound          Code = "NOT_FOUND"
	CodeForbidden         Code = "FORBIDDEN"
	CodeConflict          Code = "CONFLICT"
	CodeInvalidState      Code = "INVALID_STATE"
	CodeUpstreamFailure   Code = "UPSTREAM_FAILURE"
	CodeInternal          Code = "INTERNAL"
	CodeNoMilestonesLeft  Code = "ALL_MILESTONES_APPROVED"
	CodeNothingToClaim    Code = "NO_APPROVED_MILESTONE"
	CodeEscrowNotActive   Code = "ESCROW_NOT_ACTIVE"
	CodeEscrowExistsAlrdy Code = "ESCROW_ALREADY_EXISTS"
)

// Error is the service's error type.
type Error struct {
	Code    Code
	Message string
	Status  int
	Err     error // internal cause; logged, never serialised
}

func (e *Error) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %s: %v", e.Code, e.Message, e.Err)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func (e *Error) Unwrap() error { return e.Err }

// From extracts an *Error, synthesising a generic 500 for anything unclassified.
func From(err error) *Error {
	var appErr *Error
	if errors.As(err, &appErr) {
		return appErr
	}
	return &Error{
		Code:    CodeInternal,
		Message: "internal server error",
		Status:  http.StatusInternalServerError,
		Err:     err,
	}
}

func New(code Code, status int, format string, args ...any) *Error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...), Status: status}
}

func InvalidInput(format string, args ...any) *Error {
	return New(CodeInvalidInput, http.StatusBadRequest, format, args...)
}

func NotFound(format string, args ...any) *Error {
	return New(CodeNotFound, http.StatusNotFound, format, args...)
}

func Forbidden(format string, args ...any) *Error {
	return New(CodeForbidden, http.StatusForbidden, format, args...)
}

// Conflict covers state-transition refusals: well-formed and authorised, but
// the escrow is not in a state that permits it.
func Conflict(code Code, format string, args ...any) *Error {
	return New(code, http.StatusConflict, format, args...)
}

// Upstream marks a dependency failure. 502 not 500, so operators can tell
// "we broke" from "something we depend on broke".
func Upstream(cause error, format string, args ...any) *Error {
	e := New(CodeUpstreamFailure, http.StatusBadGateway, format, args...)
	e.Err = cause
	return e
}

func Internal(cause error, format string, args ...any) *Error {
	e := New(CodeInternal, http.StatusInternalServerError, format, args...)
	e.Err = cause
	return e
}
