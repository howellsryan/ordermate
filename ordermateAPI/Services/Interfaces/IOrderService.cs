using ordermateAPI.Models;

namespace ordermateAPI.Services.Interfaces;

public interface IOrderService
{
    Task<OrderModel> GetByOrderNumber(string orderNumber);
    Task Create(string email, int storeId);
    Task AddItem(AddOrderItemModel addOrderItem);
    Task UpdateItem(AddOrderItemModel addOrderItem);
    Task RemoveItem(int orderItemId);
}