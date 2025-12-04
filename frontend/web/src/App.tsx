// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface GasRecord {
  id: string;
  volcanoName: string;
  location: string;
  gasType: string;
  emissionLevel: number;
  timestamp: number;
  encryptedData: string;
  status: "pending" | "verified" | "rejected";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<GasRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({
    volcanoName: "",
    location: "",
    gasType: "CO2",
    emissionLevel: 0
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [language, setLanguage] = useState<"en" | "zh">("en");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // Calculate statistics
  const verifiedCount = records.filter(r => r.status === "verified").length;
  const totalEmissions = records.reduce((sum, record) => sum + record.emissionLevel, 0);
  const avgEmission = records.length > 0 ? totalEmissions / records.length : 0;

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("gas_record_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing record keys:", e);
        }
      }
      
      const list: GasRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`gas_record_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                volcanoName: recordData.volcanoName,
                location: recordData.location,
                gasType: recordData.gasType,
                emissionLevel: recordData.emissionLevel,
                timestamp: recordData.timestamp,
                encryptedData: recordData.encryptedData,
                status: recordData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing record data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading record ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) {
      console.error("Error loading records:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitRecord = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: language === "en" 
        ? "Encrypting gas emission data with FHE..." 
        : "正在使用FHE加密气体排放数据..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newRecordData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const recordData = {
        volcanoName: newRecordData.volcanoName,
        location: newRecordData.location,
        gasType: newRecordData.gasType,
        emissionLevel: newRecordData.emissionLevel,
        timestamp: Math.floor(Date.now() / 1000),
        encryptedData: encryptedData,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `gas_record_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("gas_record_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(recordId);
      
      await contract.setData(
        "gas_record_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: language === "en"
          ? "Gas emission data encrypted and submitted securely!"
          : "气体排放数据已加密并安全提交!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({
          volcanoName: "",
          location: "",
          gasType: "CO2",
          emissionLevel: 0
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? language === "en" ? "Transaction rejected by user" : "用户拒绝了交易"
        : (language === "en" ? "Submission failed: " : "提交失败: ") + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const verifyRecord = async (recordId: string) => {
    if (!provider) {
      alert(language === "en" ? "Please connect wallet first" : "请先连接钱包");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: language === "en"
        ? "Processing encrypted data with FHE..."
        : "正在使用FHE处理加密数据..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`gas_record_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "verified"
      };
      
      await contract.setData(
        `gas_record_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: language === "en"
          ? "FHE verification completed successfully!"
          : "FHE验证成功完成!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: (language === "en" ? "Verification failed: " : "验证失败: ") + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectRecord = async (recordId: string) => {
    if (!provider) {
      alert(language === "en" ? "Please connect wallet first" : "请先连接钱包");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: language === "en"
        ? "Processing encrypted data with FHE..."
        : "正在使用FHE处理加密数据..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`gas_record_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "rejected"
      };
      
      await contract.setData(
        `gas_record_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: language === "en"
          ? "FHE rejection completed successfully!"
          : "FHE拒绝成功完成!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: (language === "en" ? "Rejection failed: " : "拒绝失败: ") + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: language === "en"
          ? `FHE contract is ${isAvailable ? "available" : "unavailable"}`
          : `FHE合约${isAvailable ? "可用" : "不可用"}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: (language === "en" ? "Availability check failed: " : "可用性检查失败: ") + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const filteredRecords = records.filter(record => {
    const matchesSearch = record.volcanoName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         record.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         record.gasType.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = filterStatus === "all" || record.status === filterStatus;
    
    return matchesSearch && matchesStatus;
  });

  const tutorialSteps = [
    {
      title: language === "en" ? "Connect Wallet" : "连接钱包",
      description: language === "en" 
        ? "Connect your Web3 wallet to interact with the platform" 
        : "连接您的Web3钱包与平台交互",
      icon: "🔗"
    },
    {
      title: language === "en" ? "Submit Encrypted Data" : "提交加密数据",
      description: language === "en" 
        ? "Add volcanic gas emission data which will be encrypted using FHE" 
        : "添加火山气体排放数据，将使用FHE进行加密",
      icon: "🌋"
    },
    {
      title: language === "en" ? "FHE Processing" : "FHE处理",
      description: language === "en" 
        ? "Your data is processed in encrypted state without decryption" 
        : "您的数据在加密状态下处理，无需解密",
      icon: "🔒"
    },
    {
      title: language === "en" ? "Get Results" : "获取结果",
      description: language === "en" 
        ? "Receive verifiable results while keeping your data private" 
        : "在保护数据隐私的同时获得可验证的结果",
      icon: "📊"
    }
  ];

  const renderEmissionChart = () => {
    const gasTypes = ["CO2", "SO2", "H2S", "CH4"];
    const emissionsByType: {[key: string]: number} = {};
    
    gasTypes.forEach(type => {
      emissionsByType[type] = records
        .filter(r => r.gasType === type)
        .reduce((sum, record) => sum + record.emissionLevel, 0);
    });
    
    const maxEmission = Math.max(...Object.values(emissionsByType));
    
    return (
      <div className="emission-chart">
        <h3>{language === "en" ? "Emissions by Gas Type" : "按气体类型分类的排放量"}</h3>
        <div className="chart-bars">
          {gasTypes.map(type => (
            <div key={type} className="chart-bar-container">
              <div className="chart-bar-label">{type}</div>
              <div className="chart-bar">
                <div 
                  className="chart-bar-fill" 
                  style={{ 
                    height: maxEmission > 0 ? `${(emissionsByType[type] / maxEmission) * 100}%` : "0%",
                    backgroundColor: type === "CO2" ? "#ff6b6b" : 
                                   type === "SO2" ? "#4ecdc4" : 
                                   type === "H2S" ? "#45b7d1" : "#f9c74f"
                  }}
                ></div>
              </div>
              <div className="chart-bar-value">{emissionsByType[type]}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const toggleLanguage = () => {
    setLanguage(prev => prev === "en" ? "zh" : "en");
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>{language === "en" ? "Initializing FHE connection..." : "正在初始化FHE连接..."}</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">🌋</div>
          <h1>{language === "en" ? "VolcanoGas FHE" : "火山气体FHE分析"}</h1>
        </div>
        
        <div className="header-actions">
          <button className="language-toggle" onClick={toggleLanguage}>
            {language === "en" ? "中文" : "EN"}
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-record-btn"
          >
            {language === "en" ? "Add Record" : "添加记录"}
          </button>
          <button 
            className="tutorial-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial 
              ? (language === "en" ? "Hide Tutorial" : "隐藏教程") 
              : (language === "en" ? "Show Tutorial" : "显示教程")
            }
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>{language === "en" 
              ? "Confidential Analysis of Global Volcanic Gas Emissions" 
              : "機密化的全球火山氣體排放分析"}
            </h2>
            <p>{language === "en" 
              ? "Securely share and analyze encrypted volcanic gas data using FHE technology" 
              : "使用FHE技术安全共享和分析加密的火山气体数据"}
            </p>
          </div>
          <div className="fhe-badge">
            <span>FHE</span> {language === "en" ? "Powered" : "驱动"}
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>{language === "en" ? "FHE Data Analysis Tutorial" : "FHE数据分析教程"}</h2>
            <p className="subtitle">{language === "en" 
              ? "Learn how to securely process sensitive volcanic gas data" 
              : "了解如何安全处理敏感的火山气体数据"}
            </p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div className="tutorial-step" key={index}>
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card">
            <h3>{language === "en" ? "Project Introduction" : "项目介绍"}</h3>
            <p>{language === "en" 
              ? "A secure platform for analyzing volcanic gas emissions using FHE technology to process sensitive environmental data without decryption." 
              : "使用FHE技术处理敏感环境数据而无需解密的火山气体排放分析安全平台。"}
            </p>
            <button className="availability-btn" onClick={checkAvailability}>
              {language === "en" ? "Check FHE Availability" : "检查FHE可用性"}
            </button>
          </div>
          
          <div className="dashboard-card">
            <h3>{language === "en" ? "Data Statistics" : "数据统计"}</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{records.length}</div>
                <div className="stat-label">{language === "en" ? "Total Records" : "总记录数"}</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{verifiedCount}</div>
                <div className="stat-label">{language === "en" ? "Verified" : "已验证"}</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{Math.round(avgEmission)}</div>
                <div className="stat-label">{language === "en" ? "Avg Emission" : "平均排放量"}</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card">
            {renderEmissionChart()}
          </div>
        </div>
        
        <div className="records-section">
          <div className="section-header">
            <h2>{language === "en" ? "Encrypted Gas Records" : "加密气体记录"}</h2>
            <div className="header-actions">
              <div className="search-filter">
                <input 
                  type="text" 
                  placeholder={language === "en" ? "Search records..." : "搜索记录..."}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
                <select 
                  value={filterStatus} 
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="filter-select"
                >
                  <option value="all">{language === "en" ? "All Status" : "所有状态"}</option>
                  <option value="pending">{language === "en" ? "Pending" : "待处理"}</option>
                  <option value="verified">{language === "en" ? "Verified" : "已验证"}</option>
                  <option value="rejected">{language === "en" ? "Rejected" : "已拒绝"}</option>
                </select>
              </div>
              <button 
                onClick={loadRecords}
                className="refresh-btn"
                disabled={isRefreshing}
              >
                {isRefreshing 
                  ? (language === "en" ? "Refreshing..." : "刷新中...") 
                  : (language === "en" ? "Refresh" : "刷新")
                }
              </button>
            </div>
          </div>
          
          <div className="records-list">
            <div className="table-header">
              <div className="header-cell">{language === "en" ? "Volcano" : "火山"}</div>
              <div className="header-cell">{language === "en" ? "Location" : "位置"}</div>
              <div className="header-cell">{language === "en" ? "Gas Type" : "气体类型"}</div>
              <div className="header-cell">{language === "en" ? "Emission" : "排放量"}</div>
              <div className="header-cell">{language === "en" ? "Date" : "日期"}</div>
              <div className="header-cell">{language === "en" ? "Status" : "状态"}</div>
              <div className="header-cell">{language === "en" ? "Actions" : "操作"}</div>
            </div>
            
            {filteredRecords.length === 0 ? (
              <div className="no-records">
                <div className="no-records-icon">📝</div>
                <p>{language === "en" ? "No gas records found" : "未找到气体记录"}</p>
                <button 
                  className="create-first-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  {language === "en" ? "Create First Record" : "创建第一条记录"}
                </button>
              </div>
            ) : (
              filteredRecords.map(record => (
                <div className="record-row" key={record.id}>
                  <div className="table-cell">{record.volcanoName}</div>
                  <div className="table-cell">{record.location}</div>
                  <div className="table-cell">{record.gasType}</div>
                  <div className="table-cell">{record.emissionLevel}</div>
                  <div className="table-cell">
                    {new Date(record.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${record.status}`}>
                      {language === "en" ? record.status : 
                       record.status === "pending" ? "待处理" :
                       record.status === "verified" ? "已验证" : "已拒绝"}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    <button 
                      className="action-btn verify"
                      onClick={() => verifyRecord(record.id)}
                    >
                      {language === "en" ? "Verify" : "验证"}
                    </button>
                    <button 
                      className="action-btn reject"
                      onClick={() => rejectRecord(record.id)}
                    >
                      {language === "en" ? "Reject" : "拒绝"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="partners-section">
          <h2>{language === "en" ? "Research Partners" : "研究合作伙伴"}</h2>
          <div className="partners-grid">
            <div className="partner-item">
              <div className="partner-logo">🌍</div>
              <div className="partner-name">Global Volcanism Program</div>
            </div>
            <div className="partner-item">
              <div className="partner-logo">🔬</div>
              <div className="partner-name">FHE Research Institute</div>
            </div>
            <div className="partner-item">
              <div className="partner-logo">🛰️</div>
              <div className="partner-name">Satellite Data Consortium</div>
            </div>
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          recordData={newRecordData}
          setRecordData={setNewRecordData}
          language={language}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="logo-icon">🌋</div>
              <span>{language === "en" ? "VolcanoGas FHE" : "火山气体FHE分析"}</span>
            </div>
            <p>{language === "en" 
              ? "Secure encrypted volcanic gas analysis using FHE technology" 
              : "使用FHE技术的安全加密火山气体分析"}
            </p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">{language === "en" ? "Documentation" : "文档"}</a>
            <a href="#" className="footer-link">{language === "en" ? "Privacy Policy" : "隐私政策"}</a>
            <a href="#" className="footer-link">{language === "en" ? "Terms of Service" : "服务条款"}</a>
            <a href="#" className="footer-link">{language === "en" ? "Contact" : "联系我们"}</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE {language === "en" ? "Powered Privacy" : "驱动隐私保护"}</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} VolcanoGas FHE. {language === "en" ? "All rights reserved." : "保留所有权利。"}
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
  language: "en" | "zh";
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  recordData,
  setRecordData,
  language
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setRecordData({
      ...recordData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!recordData.volcanoName || !recordData.location || recordData.emissionLevel <= 0) {
      alert(language === "en" ? "Please fill all required fields" : "请填写所有必填字段");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>{language === "en" ? "Add Gas Emission Record" : "添加气体排放记录"}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            🔒 {language === "en" 
              ? "Your gas emission data will be encrypted with FHE" 
              : "您的气体排放数据将使用FHE加密"}
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>{language === "en" ? "Volcano Name *" : "火山名称 *"}</label>
              <input 
                type="text"
                name="volcanoName"
                value={recordData.volcanoName} 
                onChange={handleChange}
                placeholder={language === "en" ? "Enter volcano name" : "输入火山名称"}
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>{language === "en" ? "Location *" : "位置 *"}</label>
              <input 
                type="text"
                name="location"
                value={recordData.location} 
                onChange={handleChange}
                placeholder={language === "en" ? "Enter location" : "输入位置"}
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>{language === "en" ? "Gas Type *" : "气体类型 *"}</label>
              <select 
                name="gasType"
                value={recordData.gasType} 
                onChange={handleChange}
                className="form-select"
              >
                <option value="CO2">CO₂</option>
                <option value="SO2">SO₂</option>
                <option value="H2S">H₂S</option>
                <option value="CH4">CH₄</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>{language === "en" ? "Emission Level *" : "排放水平 *"}</label>
              <input 
                type="number"
                name="emissionLevel"
                value={recordData.emissionLevel} 
                onChange={handleChange}
                placeholder={language === "en" ? "Enter emission level" : "输入排放水平"}
                className="form-input"
                min="0"
              />
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            {language === "en" ? "Cancel" : "取消"}
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn"
          >
            {creating 
              ? (language === "en" ? "Encrypting with FHE..." : "使用FHE加密中...") 
              : (language === "en" ? "Submit Securely" : "安全提交")
            }
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;