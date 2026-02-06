"""
Minimal tests for Stripe webhook signature verification helper.

These tests exercise the happy path and failure case of using
stripe.Webhook.construct_event with a known secret.
"""

import time

import stripe


def test_webhook_signature_happy_path():
    secret = "whsec_test_secret"
    payload = b'{"id":"evt_test","object":"event"}'
    timestamp = int(time.time())
    signed_payload = f"{timestamp}.{payload.decode()}".encode()

    signature = stripe.WebhookSignature._compute_signature(signed_payload, secret)
    header = f"t={timestamp},v1={signature}"

    event = stripe.Webhook.construct_event(payload=payload, sig_header=header, secret=secret)
    assert event["id"] == "evt_test"


def test_webhook_signature_invalid():
    secret = "whsec_test_secret"
    payload = b'{"id":"evt_test","object":"event"}'
    bad_header = "t=1234567890,v1=invalid"

    try:
        stripe.Webhook.construct_event(payload=payload, sig_header=bad_header, secret=secret)
        assert False, "Expected SignatureVerificationError"
    except stripe.error.SignatureVerificationError:
        # Expected path
        pass

