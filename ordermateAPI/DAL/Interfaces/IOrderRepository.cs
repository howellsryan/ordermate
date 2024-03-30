using ordermateAPI.DAL.Models;

namespace ordermateAPI.DAL.Interfaces;

public interface IOrderRepository
{
    Task<OrderModel?> Get(int orderId);
    Task<OrderModel?> Get(string orderNumber);
    Task<IEnumerable<OrderModel>> GetByStoreId(int storeId);
    Task<int> Create(string email, int storeId);
    Task UpdateOrderTotalValue(int orderId, decimal totalValue);
}