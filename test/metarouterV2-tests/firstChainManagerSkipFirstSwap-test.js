const { expect } = require("chai");
const { ethers } = require("hardhat");
const library = require("../utils");
const {
	swapInterface,
	hardhatChainID,
	stableBridgingFee,
	burnInterface,
	deployTokensMetaRouterTest,
} = require("../utils");
const stableSwapInterface = new ethers.utils.Interface([
	"function multicall(uint256,bytes[],address[],address[],uint256[],address)",
]);

let firstToken,
	secondToken,
	thirdToken,
	bridge1,
	bridge2,
	symbDex,
	stableDex,
	uniDex,
	weth,
	metaRouter,
	sTestTokenAddr,
	sWethAddr,
	portal1,
	synthesis,
	sTestToken,
	sweth,
	owner,
	recipient,
	sender;

describe("MetaRouter V2 tests", function () {
	beforeEach(async () => {
		[owner, recipient, sender, provider] = await ethers.getSigners();

		console.log("Owner account:", owner.address);

		[firstToken, secondToken, thirdToken, weth] =
			await deployTokensMetaRouterTest();

		[_, bridge1, bridge2, _, portal1, _, synthesis, metaRouter] =
			await library.deploySynthContracts(
				owner,
				secondToken.address,
				weth.address
			);

		await portal1.setWhitelistToken(weth.address, true);

		[sTestTokenAddr, sTestToken, sWethAddr, sweth] =
			await library.createSyntRepr(
				secondToken,
				weth,
				synthesis,
				synthesis
			);

		const StableRouter = await ethers.getContractFactory("MulticallRouter");
		stableRouter = await StableRouter.deploy();

		[symbFactory, symbDex, stableDex, uniFactory, uniDex] =
			await library.deployDexes(owner, [sTestTokenAddr, sWethAddr], weth);

		// approves for metaRouter
		await sTestToken
			.connect(sender)
			.approve(
				await metaRouter.metaRouterGateway(),
				ethers.constants.MaxUint256
			);

		await thirdToken.mint(sender.address, 10000);

		await library.mintTokens(
			provider,
			[firstToken, secondToken, thirdToken],
			[10000, 20000 + stableBridgingFee, 10000],
			weth,
			20000 + stableBridgingFee
		);

		await library.synthesize(
			provider,
			portal1,
			20000 + stableBridgingFee,
			secondToken,
			synthesis,
			bridge2
		);

		await library.synthesize(
			provider,
			portal1,
			10000 + stableBridgingFee,
			weth,
			synthesis,
			bridge2
		);

		expect(await sTestToken.balanceOf(provider.address)).to.eq(
			String(20000)
		);

		expect(await sweth.balanceOf(provider.address)).to.eq(String(10000));

		expect(await thirdToken.balanceOf(sender.address)).to.eq(String(10000));

		console.log("All required tokens minted");

		// add liquidity to symb dex and stable dex
		firstTokenAmount = 10000;
		syntTokenAmount = 10000;
		WETHTokenAmount = 10000;
		sWETHTokenAmount = 10000;
		thirdTokenAmount = 10000;
		secondTokenAmount = 10000;

		await library.addLiquidity(
			owner,
			provider,
			symbDex,
			symbFactory,
			[[firstToken, weth]],
			[[firstTokenAmount, WETHTokenAmount]],
			[sTestToken, sweth],
			[sWETHTokenAmount, syntTokenAmount],
			uniDex,
			uniFactory,
			[[sTestToken, thirdToken]],
			[[secondTokenAmount, thirdTokenAmount]]
		);
	});

	it("Should check metaRoute synth V2 with first chain manager without first swap", async () => {
		let amountIn = 5000;

		await secondToken.mint(sender.address, amountIn + stableBridgingFee);

		await library.synthesize(
			sender,
			portal1,
			amountIn + stableBridgingFee,
			secondToken,
			synthesis,
			bridge2
		);

		let secondSwapCalldata = swapInterface.encodeFunctionData("swap", [
			0,
			1,
			0,
			0,
			ethers.constants.MaxUint256,
		]);

		let secondSwapRouterCalldata = stableSwapInterface.encodeFunctionData(
			"multicall",
			[
				0,
				[secondSwapCalldata],
				[stableDex.address],
				[sTestTokenAddr, sweth.address],
				[100],
				metaRouter.address,
			]
		);

		let finalSwapCalldata = swapInterface.encodeFunctionData(
			"swapExactTokensForTokens",
			[
				0,
				0,
				[weth.address, firstToken.address],
				recipient.address,
				ethers.constants.MaxUint256,
			]
		);

		let clientId = ethers.utils.formatBytes32String("some client id");

		let otherSideCalldata = burnInterface.encodeFunctionData(
			"metaBurnSyntheticToken",
			[
				[
					stableBridgingFee,
					0,
					sender.address,
					symbDex.address,
					sweth.address,
					finalSwapCalldata,
					36,
					recipient.address,
					portal1.address,
					bridge1.address,
					recipient.address,
					hardhatChainID,
					clientId,
				],
			]
		);

		let tx = await metaRouter.connect(sender).metaRoute({
			firstDexRouter: ethers.constants.AddressZero,
			secondDexRouter: stableRouter.address,
			amount: amountIn,
			nativeIn: false,
			firstSwapCalldata: ethers.utils.hexConcat([]),
			approvedTokens: [sTestTokenAddr, sWethAddr],
			secondSwapCalldata: secondSwapRouterCalldata,
			relayRecipient: synthesis.address,
			otherSideCalldata: otherSideCalldata,
		});

		let receiptMetaRoute = await tx.wait();
		let metaRouteOracleRequestArgs = await library.catchOracleRequest(
			receiptMetaRoute
		);

		let callData = metaRouteOracleRequestArgs[1];
		let receiveSide = metaRouteOracleRequestArgs[2];

		expect(receiveSide).to.eq(portal1.address);

		await bridge1.receiveRequestV2(callData, receiveSide);

		let expectedBalance = 3251;

		console.log(
			"Final balance:",
			(await firstToken.balanceOf(recipient.address)).toString()
		);

		expect(await firstToken.balanceOf(recipient.address)).to.eq(
			expectedBalance
		);
	});

	afterEach(async () => {
		// TODO: check a;; tokens balances here
		expect(await firstToken.balanceOf(metaRouter.address)).to.eq(0);
		expect(await weth.balanceOf(metaRouter.address)).to.eq(0);
		expect(await sTestToken.balanceOf(metaRouter.address)).to.eq(0);
		expect(await secondToken.balanceOf(metaRouter.address)).to.eq(0);
		expect(await thirdToken.balanceOf(metaRouter.address)).to.eq(0);
	});
});