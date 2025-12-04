// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract VolcanoGas_FHE is SepoliaConfig {
    struct EncryptedEmissionData {
        uint256 id;
        euint32 encryptedSO2;       // Sulfur dioxide levels
        euint32 encryptedCO2;       // Carbon dioxide levels
        euint32 encryptedH2S;       // Hydrogen sulfide levels
        euint32 encryptedAltitude;  // Emission altitude
        uint256 timestamp;
        string volcanoId;
    }

    struct GlobalImpactAssessment {
        euint32 encryptedClimateImpact;
        euint32 encryptedAviationRisk;
    }

    struct DecryptedAnalysis {
        uint32 climateImpactScore;
        uint32 aviationRiskScore;
        string recommendations;
        bool isRevealed;
    }

    uint256 public dataEntryCount;
    mapping(uint256 => EncryptedEmissionData) public emissionData;
    mapping(string => GlobalImpactAssessment) public globalAssessments;
    mapping(uint256 => DecryptedAnalysis) public decryptedAnalyses;
    
    mapping(uint256 => uint256) private requestToDataId;
    mapping(uint256 => string) private requestToVolcanoId;
    string[] private monitoredVolcanoes;

    event EmissionDataSubmitted(uint256 indexed id, string volcanoId, uint256 timestamp);
    event AnalysisRequested(uint256 indexed dataId);
    event AnalysisDecrypted(uint256 indexed dataId);
    event GlobalAssessmentUpdated(string volcanoId);

    modifier onlyAuthorizedContributor(string memory volcanoId) {
        _;
    }

    function submitEmissionData(
        string memory volcanoId,
        euint32 so2Level,
        euint32 co2Level,
        euint32 h2sLevel,
        euint32 altitude
    ) public onlyAuthorizedContributor(volcanoId) {
        dataEntryCount += 1;
        uint256 newId = dataEntryCount;
        
        emissionData[newId] = EncryptedEmissionData({
            id: newId,
            encryptedSO2: so2Level,
            encryptedCO2: co2Level,
            encryptedH2S: h2sLevel,
            encryptedAltitude: altitude,
            timestamp: block.timestamp,
            volcanoId: volcanoId
        });
        
        decryptedAnalyses[newId] = DecryptedAnalysis({
            climateImpactScore: 0,
            aviationRiskScore: 0,
            recommendations: "",
            isRevealed: false
        });

        if (!isVolcanoMonitored(volcanoId)) {
            monitoredVolcanoes.push(volcanoId);
            globalAssessments[volcanoId] = GlobalImpactAssessment({
                encryptedClimateImpact: FHE.asEuint32(0),
                encryptedAviationRisk: FHE.asEuint32(0)
            });
        }
        
        emit EmissionDataSubmitted(newId, volcanoId, block.timestamp);
    }

    function requestImpactAnalysis(uint256 dataId) public {
        EncryptedEmissionData storage data = emissionData[dataId];
        require(!decryptedAnalyses[dataId].isRevealed, "Already analyzed");
        
        bytes32[] memory ciphertexts = new bytes32[](4);
        ciphertexts[0] = FHE.toBytes32(data.encryptedSO2);
        ciphertexts[1] = FHE.toBytes32(data.encryptedCO2);
        ciphertexts[2] = FHE.toBytes32(data.encryptedH2S);
        ciphertexts[3] = FHE.toBytes32(data.encryptedAltitude);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.processImpactAnalysis.selector);
        requestToDataId[reqId] = dataId;
        
        emit AnalysisRequested(dataId);
    }

    function processImpactAnalysis(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 dataId = requestToDataId[requestId];
        require(dataId != 0, "Invalid request");
        
        DecryptedAnalysis storage analysis = decryptedAnalyses[dataId];
        require(!analysis.isRevealed, "Already processed");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (uint32 so2, uint32 co2, uint32 h2s, uint32 altitude) = 
            abi.decode(cleartexts, (uint32, uint32, uint32, uint32));
        
        analysis.climateImpactScore = calculateClimateImpact(so2, co2, h2s);
        analysis.aviationRiskScore = calculateAviationRisk(so2, altitude);
        analysis.recommendations = generateRecommendations(
            analysis.climateImpactScore, 
            analysis.aviationRiskScore
        );
        analysis.isRevealed = true;
        
        emit AnalysisDecrypted(dataId);
    }

    function updateGlobalAssessment(
        string memory volcanoId,
        euint32 climateImpact,
        euint32 aviationRisk
    ) public onlyAuthorizedContributor(volcanoId) {
        GlobalImpactAssessment storage assessment = globalAssessments[volcanoId];
        assessment.encryptedClimateImpact = FHE.add(
            assessment.encryptedClimateImpact, 
            climateImpact
        );
        assessment.encryptedAviationRisk = FHE.add(
            assessment.encryptedAviationRisk, 
            aviationRisk
        );
        
        emit GlobalAssessmentUpdated(volcanoId);
    }

    function requestGlobalAssessmentDecryption(string memory volcanoId) public {
        GlobalImpactAssessment storage assessment = globalAssessments[volcanoId];
        
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(assessment.encryptedClimateImpact);
        ciphertexts[1] = FHE.toBytes32(assessment.encryptedAviationRisk);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptGlobalAssessment.selector);
        requestToVolcanoId[reqId] = volcanoId;
    }

    function decryptGlobalAssessment(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        string memory volcanoId = requestToVolcanoId[requestId];
        require(bytes(volcanoId).length > 0, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (uint32 climateImpact, uint32 aviationRisk) = 
            abi.decode(cleartexts, (uint32, uint32));
    }

    function getDecryptedAnalysis(uint256 dataId) public view returns (
        uint32 climateImpact,
        uint32 aviationRisk,
        string memory recommendations,
        bool isRevealed
    ) {
        DecryptedAnalysis storage a = decryptedAnalyses[dataId];
        return (a.climateImpactScore, a.aviationRiskScore, a.recommendations, a.isRevealed);
    }

    function calculateClimateImpact(
        uint32 so2,
        uint32 co2,
        uint32 h2s
    ) private pure returns (uint32) {
        return (so2 * 3 + co2 * 1 + h2s * 2) / 10;
    }

    function calculateAviationRisk(
        uint32 so2,
        uint32 altitude
    ) private pure returns (uint32) {
        return (so2 * altitude) / 1000;
    }

    function generateRecommendations(
        uint32 climateScore,
        uint32 aviationScore
    ) private pure returns (string memory) {
        if (aviationScore > 80) return "Immediate aviation warning required";
        if (climateScore > 70) return "Significant climate impact detected";
        if (aviationScore > 50) return "Monitor aviation corridors";
        return "Standard monitoring protocol";
    }

    function isVolcanoMonitored(string memory volcanoId) private view returns (bool) {
        for (uint i = 0; i < monitoredVolcanoes.length; i++) {
            if (keccak256(bytes(monitoredVolcanoes[i])) == keccak256(bytes(volcanoId))) {
                return true;
            }
        }
        return false;
    }
}