import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accountForbiddenMessage,
  accountInputMessage,
  changePasswordMessage,
} from "../src/presentation/presenters/account-action-errors";
import { genericErrorMessage } from "../src/presentation/presenters/generic-error-message";

test("account input errors read as their fixed messages", () => {
  assert.equal(
    accountInputMessage("login-id"),
    "ログインIDは英小文字・数字・. _ - の3〜32文字にしてください。",
  );
  assert.equal(
    accountInputMessage("display-name"),
    "表示名は1〜50文字にしてください。",
  );
  assert.equal(
    accountInputMessage("password"),
    "パスワードは12〜128文字にしてください。",
  );
  assert.equal(
    accountInputMessage("login-id-taken"),
    "このログインIDはすでに使われています。",
  );
});

test("each failed password change has the form's text", () => {
  assert.equal(changePasswordMessage("forbidden"), accountForbiddenMessage);
  assert.equal(changePasswordMessage("rate-limited"), genericErrorMessage);
  assert.equal(
    changePasswordMessage("invalid-new-password"),
    "パスワードは12〜128文字にしてください。",
  );
  assert.equal(
    changePasswordMessage("password-mismatch"),
    "確認用のパスワードが一致しません。",
  );
  assert.equal(
    changePasswordMessage("invalid-current-password"),
    "現在のパスワードが違うか、一時的にロックされています。",
  );
});
