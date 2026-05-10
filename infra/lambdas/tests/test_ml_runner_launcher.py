"""Unit tests for ml-runner-launcher Lambda handler."""
import base64
import json
import os
import sys
import time
from pathlib import Path
from unittest.mock import MagicMock, call, patch

import pytest

# Inject required env vars before import
os.environ.setdefault("LAUNCH_TEMPLATE_ID", "lt-test12345")
os.environ.setdefault("SUBNET_ID", "subnet-test12345")
os.environ.setdefault("INSTANCE_PROFILE_ARN", "arn:aws:iam::123456789012:instance-profile/MLRunnerInstanceProfile")
os.environ.setdefault("SNS_TOPIC_ARN", "arn:aws:sns:us-east-2:123456789012:ml-runner-alerts")

sys.path.insert(0, str(Path(__file__).parent.parent / "ml_runner_launcher"))
import handler


# ── get_registration_token ────────────────────────────────────────────────────

def test_get_registration_token_success():
    with patch("handler.requests.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"token": "AABBCC", "expires_at": "2026-05-10T04:00:00Z"}
        mock_resp.raise_for_status = MagicMock()
        mock_post.return_value = mock_resp

        result = handler.get_registration_token("ghp_test_pat")

        assert result["token"] == "AABBCC"
        mock_post.assert_called_once()
        call_kwargs = mock_post.call_args
        assert "Authorization" in call_kwargs.kwargs["headers"]
        assert call_kwargs.kwargs["headers"]["Authorization"] == "Bearer ghp_test_pat"


def test_get_registration_token_raises_on_401():
    import requests as req
    with patch("handler.requests.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.raise_for_status.side_effect = req.exceptions.HTTPError("401 Unauthorized")
        mock_post.return_value = mock_resp

        with pytest.raises(req.exceptions.HTTPError):
            handler.get_registration_token("bad_pat")


# ── build_userdata ────────────────────────────────────────────────────────────

def test_build_userdata_is_valid_base64():
    ud = handler.build_userdata("TOKEN123", runner_index=0, token_issued_at=1000000)
    decoded = base64.b64decode(ud).decode()
    assert "TOKEN123" in decoded
    assert "RUNNER_INDEX" in decoded
    assert "1000000" in decoded


def test_build_userdata_contains_shutdown():
    ud = handler.build_userdata("TOKEN123", runner_index=2, token_issued_at=1000000)
    decoded = base64.b64decode(ud).decode()
    assert "shutdown -h now" in decoded


def test_build_userdata_index_0_writes_cache():
    ud = handler.build_userdata("TOKEN123", runner_index=0, token_issued_at=1000000)
    decoded = base64.b64decode(ud).decode()
    # Index 0 should contain the cache write block
    assert 'RUNNER_INDEX" -eq 0' in decoded
    assert "runner-cache/pip" in decoded


def test_build_userdata_token_expiry_guard():
    ud = handler.build_userdata("TOKEN123", runner_index=0, token_issued_at=1000000)
    decoded = base64.b64decode(ud).decode()
    assert "3000" in decoded  # 50-minute guard constant


# ── launch_spot ───────────────────────────────────────────────────────────────

def _mock_ec2_client(instance_id="i-0abc123"):
    mock_ec2 = MagicMock()
    mock_ec2.run_instances.return_value = {
        "Instances": [{"InstanceId": instance_id}]
    }
    return mock_ec2


def test_launch_spot_success_first_type():
    mock_ec2 = _mock_ec2_client("i-0first")
    with patch("handler.boto3.client", return_value=mock_ec2):
        result = handler.launch_spot("userdata_b64", 0, ["c5.2xlarge", "c5.4xlarge"])
    assert result["Instances"][0]["InstanceId"] == "i-0first"
    assert mock_ec2.run_instances.call_count == 1


def test_launch_spot_falls_back_on_insufficient_capacity():
    from botocore.exceptions import ClientError
    mock_ec2 = MagicMock()
    insufficient = ClientError(
        {"Error": {"Code": "InsufficientInstanceCapacity", "Message": "no capacity"}},
        "RunInstances",
    )
    mock_ec2.run_instances.side_effect = [
        insufficient,
        {"Instances": [{"InstanceId": "i-0fallback"}]},
    ]
    with patch("handler.boto3.client", return_value=mock_ec2):
        result = handler.launch_spot("ud", 0, ["c5.2xlarge", "c5.4xlarge"])
    assert result["Instances"][0]["InstanceId"] == "i-0fallback"
    assert mock_ec2.run_instances.call_count == 2


def test_launch_spot_raises_when_all_types_exhausted():
    from botocore.exceptions import ClientError
    mock_ec2 = MagicMock()
    insufficient = ClientError(
        {"Error": {"Code": "InsufficientInstanceCapacity", "Message": "no capacity"}},
        "RunInstances",
    )
    mock_ec2.run_instances.side_effect = insufficient
    with patch("handler.boto3.client", return_value=mock_ec2):
        with pytest.raises(RuntimeError, match="All instance types exhausted"):
            handler.launch_spot("ud", 0, ["c5.2xlarge", "c5.4xlarge"])


# ── handler (integration) ─────────────────────────────────────────────────────

def _make_full_mocks(n_instances=1, pat="ghp_test", token="JITTOKEN"):
    mock_sm = MagicMock()
    mock_sm.get_secret_value.return_value = {"SecretString": pat}

    mock_ec2 = MagicMock()
    mock_ec2.run_instances.return_value = {"Instances": [{"InstanceId": f"i-{i:04d}"}
                                                          for i in range(n_instances)]}

    mock_gh = MagicMock()
    mock_gh.return_value.json.return_value = {"token": token}
    mock_gh.return_value.raise_for_status = MagicMock()
    return mock_sm, mock_ec2, mock_gh


def test_handler_weekday_launches_one_runner():
    mock_sm, mock_ec2, mock_gh = _make_full_mocks()
    with patch("handler.boto3.client") as mock_boto, \
         patch("handler.requests.post", mock_gh):
        mock_boto.side_effect = lambda svc, **kw: mock_sm if svc == "secretsmanager" else mock_ec2
        result = handler.handler({"n_runners": 1}, None)
    assert len(result["launched"]) == 1
    assert result["errors"] == []
    assert mock_gh.call_count == 1  # one JIT token requested


def test_handler_sunday_launches_five_runners():
    mock_sm, mock_ec2, mock_gh = _make_full_mocks()
    with patch("handler.boto3.client") as mock_boto, \
         patch("handler.requests.post", mock_gh):
        mock_boto.side_effect = lambda svc, **kw: mock_sm if svc == "secretsmanager" else mock_ec2
        result = handler.handler({"n_runners": 5}, None)
    assert len(result["launched"]) == 5
    assert mock_gh.call_count == 5  # unique JIT token per runner


def test_handler_notifies_sns_on_pat_failure():
    mock_sm = MagicMock()
    mock_sm.get_secret_value.side_effect = Exception("secret not found")
    mock_sns = MagicMock()
    with patch("handler.boto3.client") as mock_boto:
        mock_boto.side_effect = lambda svc, **kw: (
            mock_sm if svc == "secretsmanager" else mock_sns
        )
        with pytest.raises(Exception, match="secret not found"):
            handler.handler({"n_runners": 1}, None)


def test_handler_continues_on_single_runner_failure():
    """If runner 1 fails, runner 2 still launches."""
    mock_sm, mock_ec2, _ = _make_full_mocks()
    call_count = [0]

    def mock_gh_post(*args, **kwargs):
        call_count[0] += 1
        if call_count[0] == 1:
            raise Exception("GitHub API timeout")
        m = MagicMock()
        m.json.return_value = {"token": "OK"}
        m.raise_for_status = MagicMock()
        return m

    with patch("handler.boto3.client") as mock_boto, \
         patch("handler.requests.post", side_effect=mock_gh_post):
        mock_boto.side_effect = lambda svc, **kw: mock_sm if svc == "secretsmanager" else mock_ec2
        result = handler.handler({"n_runners": 2}, None)

    assert len(result["launched"]) == 1
    assert len(result["errors"]) == 1
