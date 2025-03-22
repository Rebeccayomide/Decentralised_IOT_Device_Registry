import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v0.14.0/index.ts';
import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';

// Helper constants
const CONTRACT_NAME = 'iot-device-registry';
const TEST_DEVICE_ID = 'device-123e4567-e89b-12d3-a456-426614174000';
const TEST_STREAM_ID = 'stream-123e4567-e89b-12d3-a456-426614174000';

Clarinet.test({
    name: "Ensure that device registration works",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const user1 = accounts.get('wallet_1')!;

        let block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'register-device',
                [
                    types.utf8(TEST_DEVICE_ID),
                    types.utf8('Smart Thermostat'),
                    types.utf8('Climate Control'),
                    types.utf8('EcoTech'),
                    types.utf8('1.2.3'),
                    types.some(types.utf8('Living Room'))
                ],
                user1.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify device info was stored correctly
        const deviceInfo = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-device-info',
            [types.utf8(TEST_DEVICE_ID)],
            user1.address
        );

        const deviceTuple = deviceInfo.result.expectSome().expectTuple();
        assertEquals(deviceTuple['owner'], user1.address);
        assertEquals(deviceTuple['name'], types.utf8('Smart Thermostat'));
        assertEquals(deviceTuple['device-type'], types.utf8('Climate Control'));
        assertEquals(deviceTuple['manufacturer'], types.utf8('EcoTech'));
        assertEquals(deviceTuple['firmware-version'], types.utf8('1.2.3'));
        assertEquals(deviceTuple['status'], types.utf8('active'));
        assertEquals(deviceTuple['verified'], types.bool(false));

        // Verify owner info was updated
        const ownerInfo = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-owner-info',
            [types.principal(user1.address)],
            user1.address
        );

        const ownerTuple = ownerInfo.result.expectSome().expectTuple();
        const deviceList = ownerTuple['devices'].expectList();
        assertEquals(deviceList.length, 1);
        assertEquals(deviceList[0], types.utf8(TEST_DEVICE_ID));
        assertEquals(ownerTuple['total-streams'], types.uint(0));
        assertEquals(ownerTuple['reputation-score'], types.uint(70));
    },
});

Clarinet.test({
    name: "Ensure that duplicate device registration fails",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const user1 = accounts.get('wallet_1')!;

        // Register device first time
        let block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'register-device',
                [
                    types.utf8(TEST_DEVICE_ID),
                    types.utf8('Smart Thermostat'),
                    types.utf8('Climate Control'),
                    types.utf8('EcoTech'),
                    types.utf8('1.2.3'),
                    types.some(types.utf8('Living Room'))
                ],
                user1.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Try to register device with same ID again
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'register-device',
                [
                    types.utf8(TEST_DEVICE_ID),
                    types.utf8('Different Thermostat'),
                    types.utf8('Climate Control'),
                    types.utf8('OtherTech'),
                    types.utf8('2.0.0'),
                    types.some(types.utf8('Bedroom'))
                ],
                user1.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u2)'); // ERR-ALREADY-REGISTERED
    },
});

Clarinet.test({
    name: "Ensure that data stream registration works for device owner",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const user1 = accounts.get('wallet_1')!;

        // First register a device
        let block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'register-device',
                [
                    types.utf8(TEST_DEVICE_ID),
                    types.utf8('Smart Thermostat'),
                    types.utf8('Climate Control'),
                    types.utf8('EcoTech'),
                    types.utf8('1.2.3'),
                    types.some(types.utf8('Living Room'))
                ],
                user1.address
            )
        ]);

        // Register a data stream for the device
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'register-data-stream',
                [
                    types.utf8(TEST_STREAM_ID),
                    types.utf8(TEST_DEVICE_ID),
                    types.utf8('Temperature'),
                    types.utf8('Real-time temperature readings from the smart thermostat'),
                    types.utf8('JSON'),
                    types.uint(10), // Update frequency
                    types.uint(5000), // Price per access
                    types.bool(false) // Requires verification
                ],
                user1.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify stream info was stored correctly
        const streamInfo = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-stream-info',
            [types.utf8(TEST_STREAM_ID)],
            user1.address
        );

        const streamTuple = streamInfo.result.expectSome().expectTuple();
        assertEquals(streamTuple['device-id'], types.utf8(TEST_DEVICE_ID));
        assertEquals(streamTuple['stream-type'], types.utf8('Temperature'));
        assertEquals(streamTuple['data-format'], types.utf8('JSON'));
        assertEquals(streamTuple['price-per-access'], types.uint(5000));
        assertEquals(streamTuple['requires-verification'], types.bool(false));
        assertEquals(streamTuple['active'], types.bool(true));
        assertEquals(streamTuple['access-count'], types.uint(0));

        // Verify owner info was updated with new stream count
        const ownerInfo = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-owner-info',
            [types.principal(user1.address)],
            user1.address
        );

        const ownerTuple = ownerInfo.result.expectSome().expectTuple();
        assertEquals(ownerTuple['total-streams'], types.uint(1));
    },
});

Clarinet.test({
    name: "Ensure that non-owners cannot register data streams for others' devices",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const user1 = accounts.get('wallet_1')!;
        const user2 = accounts.get('wallet_2')!;

        // First user1 registers a device
        let block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'register-device',
                [
                    types.utf8(TEST_DEVICE_ID),
                    types.utf8('Smart Thermostat'),
                    types.utf8('Climate Control'),
                    types.utf8('EcoTech'),
                    types.utf8('1.2.3'),
                    types.some(types.utf8('Living Room'))
                ],
                user1.address
            )
        ]);

        // Try to register a data stream as user2 (non-owner)
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'register-data-stream',
                [
                    types.utf8(TEST_STREAM_ID),
                    types.utf8(TEST_DEVICE_ID),
                    types.utf8('Temperature'),
                    types.utf8('Real-time temperature readings from the smart thermostat'),
                    types.utf8('JSON'),
                    types.uint(10), // Update frequency
                    types.uint(5000), // Price per access
                    types.bool(false) // Requires verification
                ],
                user2.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u1)'); // ERR-NOT-AUTHORIZED
    },
});

Clarinet.test({
    name: "Ensure that stream access request works with proper payment",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const deviceOwner = accounts.get('wallet_1')!;
        const subscriber = accounts.get('wallet_2')!;

        // Setup device and stream
        let block = chain.mineBlock([
            // Register device
            Tx.contractCall(
                CONTRACT_NAME,
                'register-device',
                [
                    types.utf8(TEST_DEVICE_ID),
                    types.utf8('Smart Thermostat'),
                    types.utf8('Climate Control'),
                    types.utf8('EcoTech'),
                    types.utf8('1.2.3'),
                    types.some(types.utf8('Living Room'))
                ],
                deviceOwner.address
            ),
            // Register stream
            Tx.contractCall(
                CONTRACT_NAME,
                'register-data-stream',
                [
                    types.utf8(TEST_STREAM_ID),
                    types.utf8(TEST_DEVICE_ID),
                    types.utf8('Temperature'),
                    types.utf8('Real-time temperature readings from the smart thermostat'),
                    types.utf8('JSON'),
                    types.uint(10), // Update frequency
                    types.uint(5000), // Price per access
                    types.bool(false) // Requires verification
                ],
                deviceOwner.address
            )
        ]);

        // Record initial balances
        const initialDeviceOwnerBalance = deviceOwner.balance;
        const initialSubscriberBalance = subscriber.balance;
        const initialDeployerBalance = deployer.balance;

        // Subscriber requests access to stream
        const accessDuration = 144; // 1 day
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'request-stream-access',
                [
                    types.utf8(TEST_STREAM_ID),
                    types.uint(accessDuration)
                ],
                subscriber.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify access grant was created
        const accessGrant = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-access-grant',
            [
                types.principal(subscriber.address),
                types.utf8(TEST_STREAM_ID)
            ],
            subscriber.address
        );

        const grantTuple = accessGrant.result.expectSome().expectTuple();
        assertEquals(grantTuple['granted-by'], deviceOwner.address);
        assertEquals(grantTuple['access-type'], types.utf8('read'));
        assertEquals(grantTuple['payment-status'], types.bool(true));

        // Verify subscription was created
        const subscription = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-owner-info',
            [types.principal(subscriber.address)],
            subscriber.address
        );

        // Check balances to verify payment
        // Calculate expected fee
        // Base fee: 5000 * (144/144) = 5000
        // Platform fee: 5000 * 0.25% = 12.5 (rounds to 12)
        // Total fee: 5012
        const expectedBaseFee = 5000;
        const expectedPlatformFee = 12; // 5000 * 0.25% = 12.5, truncated to 12
        const expectedTotalFee = expectedBaseFee + expectedPlatformFee;

        // Verify the fee calculation function directly
        const feeCalc = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'calculate-access-fee',
            [
                types.uint(5000), // price per access
                types.uint(144) // duration
            ],
            subscriber.address
        );

        const feeTuple = feeCalc.result.expectTuple();
        assertEquals(feeTuple['base-fee'], types.uint(expectedBaseFee));
        assertEquals(feeTuple['platform-fee'], types.uint(expectedPlatformFee));
        assertEquals(feeTuple['total-fee'], types.uint(expectedTotalFee));

        // Check actual balance changes
        const asset_map = chain.getAssetsMaps();
        const deviceOwnerNewBalance = asset_map.assets[deviceOwner.address]["STX"];
        const subscriberNewBalance = asset_map.assets[subscriber.address]["STX"];
        const deployerNewBalance = asset_map.assets[deployer.address]["STX"];

        // Device owner should receive base fee
        assertEquals(deviceOwnerNewBalance, initialDeviceOwnerBalance + expectedBaseFee);
        // Subscriber should pay total fee
        assertEquals(subscriberNewBalance, initialSubscriberBalance - expectedTotalFee);
        // Contract owner (deployer) should receive platform fee
        assertEquals(deployerNewBalance, initialDeployerBalance + expectedPlatformFee);
    },
});

Clarinet.test({
    name: "Ensure that access to inactive stream fails",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deviceOwner = accounts.get('wallet_1')!;
        const subscriber = accounts.get('wallet_2')!;

        // Setup device and stream (not used in this test but referenced)
        const nonExistentStreamId = 'nonexistent-stream-id';

        // Attempt to request access to non-existent stream
        let block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'request-stream-access',
                [
                    types.utf8(nonExistentStreamId),
                    types.uint(144) // 1 day duration
                ],
                subscriber.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u4)'); // ERR-STREAM-NOT-FOUND
    },
});

Clarinet.test({
    name: "Ensure contract owner can update platform fees",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const nonOwner = accounts.get('wallet_1')!;

        // Update platform fee as owner
        let block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'update-platform-fee',
                [types.uint(50)], // 0.5%
                deployer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Try to update platform fee as non-owner
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'update-platform-fee',
                [types.uint(100)], // 1%
                nonOwner.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u1)'); // ERR-NOT-AUTHORIZED

        // Verify fee calculation with updated rate
        // New platform fee rate should be 0.5% (50/10000)
        const feeCalc = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'calculate-access-fee',
            [
                types.uint(10000), // price per access
                types.uint(144) // duration
            ],
            deployer.address
        );

        const feeTuple = feeCalc.result.expectTuple();
        // Platform fee should be 0.5% of 10000 = 50
        assertEquals(feeTuple['platform-fee'], types.uint(50));
    },
});

Clarinet.test({
    name: "Ensure contract owner can update minimum access price",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const deviceOwner = accounts.get('wallet_1')!;

        // Update minimum access price
        const newMinPrice = 2000;
        let block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'update-min-access-price',
                [types.uint(newMinPrice)],
                deployer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Register device
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'register-device',
                [
                    types.utf8(TEST_DEVICE_ID),
                    types.utf8('Smart Thermostat'),
                    types.utf8('Climate Control'),
                    types.utf8('EcoTech'),
                    types.utf8('1.2.3'),
                    types.some(types.utf8('Living Room'))
                ],
                deviceOwner.address
            )
        ]);

        // Try to register stream with price below minimum
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'register-data-stream',
                [
                    types.utf8(TEST_STREAM_ID),
                    types.utf8(TEST_DEVICE_ID),
                    types.utf8('Temperature'),
                    types.utf8('Real-time temperature readings from the smart thermostat'),
                    types.utf8('JSON'),
                    types.uint(10), // Update frequency
                    types.uint(1000), // Price below new minimum
                    types.bool(false) // Requires verification
                ],
                deviceOwner.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u10)'); // ERR-INVALID-PRICE

        // Now try with valid price
        block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                'register-data-stream',
                [
                    types.utf8(TEST_STREAM_ID),
                    types.utf8(TEST_DEVICE_ID),
                    types.utf8('Temperature'),
                    types.utf8('Real-time temperature readings from the smart thermostat'),
                    types.utf8('JSON'),
                    types.uint(10), // Update frequency
                    types.uint(newMinPrice), // Valid price
                    types.bool(false) // Requires verification
                ],
                deviceOwner.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');
    },
});

Clarinet.test({
    name: "Ensure read-only functions return proper data",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deviceOwner = accounts.get('wallet_1')!;

        // Setup device and stream
        let block = chain.mineBlock([
            // Register device
            Tx.contractCall(
                CONTRACT_NAME,
                'register-device',
                [
                    types.utf8(TEST_DEVICE_ID),
                    types.utf8('Smart Thermostat'),
                    types.utf8('Climate Control'),
                    types.utf8('EcoTech'),
                    types.utf8('1.2.3'),
                    types.some(types.utf8('Living Room'))
                ],
                deviceOwner.address
            ),
            // Register stream
            Tx.contractCall(
                CONTRACT_NAME,
                'register-data-stream',
                [
                    types.utf8(TEST_STREAM_ID),
                    types.utf8(TEST_DEVICE_ID),
                    types.utf8('Temperature'),
                    types.utf8('Real-time temperature readings from the smart thermostat'),
                    types.utf8('JSON'),
                    types.uint(10), // Update frequency
                    types.uint(5000), // Price per access
                    types.bool(false) // Requires verification
                ],
                deviceOwner.address
            )
        ]);

        // Test get-device-info
        const deviceInfo = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-device-info',
            [types.utf8(TEST_DEVICE_ID)],
            deviceOwner.address
        );

        const deviceTuple = deviceInfo.result.expectSome().expectTuple();
        assertEquals(deviceTuple['owner'], deviceOwner.address);
        assertEquals(deviceTuple['name'], types.utf8('Smart Thermostat'));

        // Test get-stream-info
        const streamInfo = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-stream-info',
            [types.utf8(TEST_STREAM_ID)],
            deviceOwner.address
        );

        const streamTuple = streamInfo.result.expectSome().expectTuple();
        assertEquals(streamTuple['device-id'], types.utf8(TEST_DEVICE_ID));
        assertEquals(streamTuple['stream-type'], types.utf8('Temperature'));

        // Test get-owner-info
        const ownerInfo = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-owner-info',
            [types.principal(deviceOwner.address)],
            deviceOwner.address
        );

        const ownerTuple = ownerInfo.result.expectSome().expectTuple();
        assertEquals(ownerTuple['total-streams'], types.uint(1));
        assertEquals(ownerTuple['reputation-score'], types.uint(70));

        // Test non-existent data
        const nonExistentDevice = chain.callReadOnlyFn(
            CONTRACT_NAME,
            'get-device-info',
            [types.utf8('non-existent-id')],
            deviceOwner.address
        );

        assertEquals(nonExistentDevice.result, 'none');
    },
});