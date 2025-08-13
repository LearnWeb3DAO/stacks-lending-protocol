import { Cl } from "@stacks/transactions";
import { describe, expect, it } from "vitest";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const updater = accounts.get("wallet_1")!;
const otherUser = accounts.get("wallet_2")!;

describe("Mock Oracle Tests", () => {
  it("should initialize the oracle with the correct owner and updater", () => {
    const { result } = simnet.callPublicFn(
      "mock-oracle",
      "initialize",
      [Cl.principal(updater)],
      deployer
    );
    expect(result).toBeOk(Cl.bool(true));

    const storedUpdater = simnet.callReadOnlyFn(
      "mock-oracle",
      "get-updater",
      [],
      deployer
    );
    expect(storedUpdater.result).toEqual(Cl.principal(updater));

    const isInitialized = simnet.callReadOnlyFn(
      "mock-oracle",
      "is-initialized",
      [],
      deployer
    );
    expect(isInitialized.result).toEqual(Cl.bool(true));
  });

  it("should not allow non-owner to initialize the oracle", () => {
    const { result } = simnet.callPublicFn(
      "mock-oracle",
      "initialize",
      [Cl.principal(updater)],
      otherUser
    );
    expect(result).toBeErr(Cl.uint(100));
  });

  it("should not allow re-initialization", () => {
    simnet.callPublicFn(
      "mock-oracle",
      "initialize",
      [Cl.principal(updater)],
      deployer
    );
    const { result } = simnet.callPublicFn(
      "mock-oracle",
      "initialize",
      [Cl.principal(updater)],
      deployer
    );
    expect(result).toBeErr(Cl.uint(101));
  });

  it("should allow updater to update the price", () => {
    simnet.callPublicFn(
      "mock-oracle",
      "initialize",
      [Cl.principal(updater)],
      deployer
    );
    const { result } = simnet.callPublicFn(
      "mock-oracle",
      "update-price",
      [Cl.uint(50000)],
      updater
    );
    expect(result).toBeOk(Cl.bool(true));

    const price = simnet.callReadOnlyFn(
      "mock-oracle",
      "get-price",
      [],
      deployer
    );
    expect(price.result).toEqual(Cl.ok(Cl.uint(50000)));
  });

  it("should not allow non-updater to update the price", () => {
    simnet.callPublicFn(
      "mock-oracle",
      "initialize",
      [Cl.principal(updater)],
      deployer
    );
    const { result } = simnet.callPublicFn(
      "mock-oracle",
      "update-price",
      [Cl.uint(50000)],
      otherUser
    );
    expect(result).toBeErr(Cl.uint(102));
  });

  it("should not allow updating the price if not initialized", () => {
    const { result } = simnet.callPublicFn(
      "mock-oracle",
      "update-price",
      [Cl.uint(50000)],
      updater
    );
    expect(result).toBeErr(Cl.uint(103));
  });

  it("should get the correct price", () => {
    simnet.callPublicFn(
      "mock-oracle",
      "initialize",
      [Cl.principal(updater)],
      deployer
    );
    simnet.callPublicFn(
      "mock-oracle",
      "update-price",
      [Cl.uint(50000)],
      updater
    );
    const { result } = simnet.callReadOnlyFn(
      "mock-oracle",
      "get-price",
      [],
      deployer
    );
    expect(result).toEqual(Cl.ok(Cl.uint(50000)));
  });

  it("should get the correct updater", () => {
    simnet.callPublicFn(
      "mock-oracle",
      "initialize",
      [Cl.principal(updater)],
      deployer
    );
    const { result } = simnet.callReadOnlyFn(
      "mock-oracle",
      "get-updater",
      [],
      deployer
    );
    expect(result).toEqual(Cl.principal(updater));
  });

  it("should get the correct initialized status", () => {
    const { result: before } = simnet.callReadOnlyFn(
      "mock-oracle",
      "is-initialized",
      [],
      deployer
    );
    expect(before).toEqual(Cl.bool(false));

    simnet.callPublicFn(
      "mock-oracle",
      "initialize",
      [Cl.principal(updater)],
      deployer
    );

    const { result: after } = simnet.callReadOnlyFn(
      "mock-oracle",
      "is-initialized",
      [],
      deployer
    );
    expect(after).toEqual(Cl.bool(true));
  });
});
